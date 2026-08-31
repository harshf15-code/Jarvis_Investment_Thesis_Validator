import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildHoldingReviewContext,
  detectTriggers,
  parseHoldingRead,
  signalHeadline,
  signalPriority,
  HOLDING_REVIEW_SYSTEM_PROMPT,
  type WatchState,
} from "@/lib/holding-watch";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getHoldingSnapshot, getQuote } from "@/lib/market-data";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import type { Database, HoldingReviewTrigger, Json } from "@/lib/types";

/**
 * Runs one holding's review, end to end.
 *
 * Shared by the scheduled drain (service-role, no session) and the trader
 * pressing "re-run this read" (their own client). Both do exactly the same
 * work, and the one thing that must not fork between them is when a model call
 * is made — a scheduled path with its own looser rule for spending money would
 * be a hole in the cap rather than a feature.
 *
 * `supabase` may therefore be either client. Every table touched here carries
 * an owner_all policy, so the user client is correctly scoped and the admin
 * client is correctly unscoped; `userId` is passed explicitly because under
 * the service role `auth.uid()` is null and the `default auth.uid()` on
 * `user_id` would insert a null into a NOT NULL column.
 */

export type ReviewOutcome =
  | { status: "reviewed"; trigger: HoldingReviewTrigger; reviewId: string; flagged: boolean }
  /** Checked, nothing material. Costs no model call — the whole point of
   *  storing a previous snapshot is to be able to NOT ask. */
  | { status: "unchanged" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

type Client = SupabaseClient<Database>;

/** Today in UTC. Earnings dates are calendar days, and the drain has no user
 *  timezone to be local to. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function reviewHolding(input: {
  supabase: Client;
  userId: string;
  positionId: string;
  /** A trader asking for a read gets one whether or not anything moved. */
  force: boolean;
  today?: string;
}): Promise<ReviewOutcome> {
  const { supabase, userId, positionId, force } = input;
  const today = input.today ?? utcToday();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id, stock_id, status")
    .eq("id", positionId)
    .maybeSingle();
  if (positionError) return { status: "failed", error: positionError.message };
  if (!position) return { status: "failed", error: "Position not found" };

  const [{ data: thesis }, { data: stock }, { data: entries }, { data: profile }, { data: state }] =
    await Promise.all([
      supabase.from("theses").select("id, input_text, source").eq("id", position.thesis_id).maybeSingle(),
      supabase.from("stocks").select("ticker, yahoo_symbol, currency, last_price").eq("id", position.stock_id).maybeSingle(),
      supabase.from("entries").select("quantity, price, date").eq("position_id", positionId),
      supabase.from("portfolio_profiles").select("objective").eq("user_id", userId).maybeSingle(),
      supabase.from("holding_watch_state").select("*").eq("position_id", positionId).maybeSingle(),
    ]);

  if (!stock?.yahoo_symbol) {
    return { status: "failed", error: `${position.ticker} has no resolved listing to read` };
  }

  const previous: WatchState = {
    fundamentals: (state?.fundamentals as Record<string, unknown> | null) ?? {},
    nextEarningsDate: state?.next_earnings_date ?? null,
    lastEarningsSeen: state?.last_earnings_seen ?? null,
  };
  const isInitial = state?.last_checked_at == null;

  let observed;
  let price: number | null;
  try {
    const [snapshot, quote] = await Promise.all([
      getHoldingSnapshot(stock.yahoo_symbol),
      // Not fatal: a review can be written against fundamentals alone, and the
      // stored `last_price` is the fallback the rest of the app already uses.
      getQuote(stock.yahoo_symbol).catch(() => null),
    ]);
    observed = snapshot;
    price = quote?.price ?? stock.last_price ?? null;
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  const detected = detectTriggers({ state: previous, observed, today });

  const writeState = async (checked: boolean) => {
    await supabase.from("holding_watch_state").upsert(
      {
        position_id: positionId,
        user_id: userId,
        fundamentals: detected.nextState.fundamentals as Json,
        next_earnings_date: detected.nextState.nextEarningsDate,
        last_earnings_seen: detected.nextState.lastEarningsSeen,
        ...(checked ? { last_checked_at: new Date().toISOString() } : {}),
      },
      { onConflict: "position_id" },
    );
  };

  // Nothing moved and nobody asked. Record that we looked and spend nothing —
  // this is the branch that keeps a weekly watch over a large book affordable.
  if (!force && !isInitial && detected.triggers.length === 0) {
    await writeState(true);
    return { status: "unchanged" };
  }

  const budget = await checkBudget(userId);
  if (!budget.ok) {
    // State is deliberately NOT advanced: this holding still needs reviewing,
    // and marking it checked would mean it silently waits another full week
    // after the trader's budget resets.
    return { status: "skipped", reason: budget.message };
  }

  // `manual` covers both a trader asking and the first-ever read. Otherwise
  // the calendar wins over a fundamentals move — an earnings date is a harder
  // fact and the more useful headline.
  const trigger: HoldingReviewTrigger =
    force || isInitial
      ? "manual"
      : detected.triggers.includes("earnings_calendar")
        ? "earnings_calendar"
        : (detected.triggers[0] ?? "scheduled");

  const weightedAverage = computeWeightedAverageEntry(entries ?? []);
  const heldSince = (entries ?? []).map((e) => e.date).sort()[0] ?? null;

  const context = buildHoldingReviewContext({
    ticker: position.ticker,
    companyName: null,
    currency: stock.currency,
    quantity: weightedAverage.totalQuantity,
    averagePrice: weightedAverage.averagePrice,
    currentPrice: price,
    rationale: rationaleFrom(thesis?.input_text ?? null, position.ticker),
    objective: profile?.objective ?? null,
    heldSince,
    fundamentals: observed.fundamentals,
    changes: detected.changes,
    upcomingEarnings: detected.upcomingEarnings,
    passedEarnings: detected.passedEarnings,
    earningsDateIsEstimate: observed.earningsDateIsEstimate,
    isInitial,
  });

  let raw: string;
  try {
    const result = await meteredGenerateText({
      userId,
      feature: "holding_review",
      thesisId: position.thesis_id,
      system: HOLDING_REVIEW_SYSTEM_PROMPT,
      prompt: context,
    });
    raw = result.text;
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  const parsed = parseHoldingRead(raw);
  if (!parsed.ok) return { status: "failed", error: parsed.error };

  const { data: review, error: reviewError } = await supabase
    .from("holding_reviews")
    .insert({
      user_id: userId,
      thesis_id: position.thesis_id,
      position_id: positionId,
      trigger,
      document: parsed.data as unknown as Json,
      raw_llm_response: raw,
    })
    .select("id")
    .single();
  if (reviewError || !review) {
    return { status: "failed", error: reviewError?.message ?? "Failed to save the review" };
  }

  // A Feed row only for a read the watch went looking for. An initial read and
  // a trader-requested re-run are already on screen where they were asked for;
  // putting them in the Feed too would make the Feed a log rather than a list
  // of things that need attention.
  const flagged = trigger === "earnings_calendar" || trigger === "fundamentals_delta";
  if (flagged) {
    const { error: signalError } = await supabase.from("intelligence_signals").insert({
      user_id: userId,
      priority: signalPriority(parsed.data.lean),
      ticker: position.ticker,
      thesis_id: position.thesis_id,
      headline: signalHeadline({
        ticker: position.ticker,
        lean: parsed.data.lean,
        passedEarnings: detected.passedEarnings,
        upcomingEarnings: detected.upcomingEarnings,
        changes: detected.changes,
      }),
    });
    if (signalError) {
      // The review is saved and readable on the position page; only its Feed
      // entry is missing. Losing the review over that would be the worse trade.
      console.error("[holding-watch] review saved but not surfaced in the Feed", signalError);
    }
  }

  await writeState(true);
  return { status: "reviewed", trigger, reviewId: review.id, flagged };
}

/**
 * The trader's own words, or null.
 *
 * An import writes a placeholder into `theses.input_text` because the column is
 * NOT NULL, and feeding that placeholder to the model as a stated thesis would
 * have it solemnly assess "Imported holding — INFY" as a reason to own
 * something. Null is the honest value, and the prompt handles it explicitly.
 */
function rationaleFrom(inputText: string | null, ticker: string): string | null {
  if (!inputText) return null;
  const placeholder = `Imported holding — ${ticker}. No stated reason recorded at import.`;
  return inputText.trim() === placeholder ? null : inputText;
}
