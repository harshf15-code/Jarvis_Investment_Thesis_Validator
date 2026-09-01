import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildHoldingReviewContext,
  detectTriggers,
  parseHoldingRead,
  signalHeadline,
  signalPriority,
  statedRationale,
  HOLDING_REVIEW_SYSTEM_PROMPT,
  type WatchState,
} from "@/lib/holding-watch";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getHoldingSnapshot, getQuote } from "@/lib/market-data";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import type { Database, HoldingReviewTrigger, Json, ThesisSource } from "@/lib/types";

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

/**
 * Everything Jarvis needs to say something about one holding: what is owned,
 * what it cost, why the trader says they own it, what the portfolio is for, and
 * what the market says about it right now.
 *
 * Extracted from `reviewHolding` so the exit-plan builder
 * (`app/api/positions/[id]/exit-plan`) grounds its proposed stop in the exact
 * same facts the recurring read is judged against. Two copies of this fan-out
 * would drift — different columns, a different price fallback — and then the
 * read and the stop sitting on the same screen would disagree about the
 * holding they are both describing.
 */
export type HoldingContext = {
  position: { id: string; ticker: string; thesis_id: string; stock_id: string; status: string };
  thesis: { id: string; input_text: string | null; source: ThesisSource } | null;
  stock: { ticker: string; yahoo_symbol: string; currency: string; last_price: number | null };
  entries: { quantity: number; price: number; date: string }[];
  /** Already sold, so `remaining` is what is actually still at risk. */
  exited: number;
  objective: string | null;
  /** The watch row, or null when this holding has never been read. */
  state: {
    last_checked_at: string | null;
    fundamentals: unknown;
    next_earnings_date: string | null;
    last_earnings_seen: string | null;
  } | null;
  observed: {
    fundamentals: Record<string, string | number>;
    earningsDates: string[];
    earningsDateIsEstimate: boolean;
  };
  /** Live where possible, the cached `stocks.last_price` otherwise, null if
   *  neither. */
  price: number | null;
  weightedAverage: ReturnType<typeof computeWeightedAverageEntry>;
  remaining: number;
  heldSince: string | null;
  /** The trader's own words, or null — never the import placeholder. */
  rationale: string | null;
};

export type HoldingContextResult =
  | { ok: true; context: HoldingContext }
  /** `not_found` is separated so a caller can answer 404 rather than 500. RLS
   *  is what makes it a 404: a position belonging to someone else reads as
   *  absent, and it must keep reading as absent. */
  | { ok: false; kind: "not_found" | "failed"; error: string };

export async function loadHoldingContext(input: {
  supabase: Client;
  userId: string;
  positionId: string;
}): Promise<HoldingContextResult> {
  const { supabase, userId, positionId } = input;

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id, stock_id, status")
    .eq("id", positionId)
    .maybeSingle();
  if (positionError) return { ok: false, kind: "failed", error: positionError.message };
  if (!position) return { ok: false, kind: "not_found", error: "Position not found" };

  const [thesisRes, stockRes, entriesRes, exitsRes, profileRes, stateRes] = await Promise.all([
    supabase.from("theses").select("id, input_text, source").eq("id", position.thesis_id).maybeSingle(),
    supabase.from("stocks").select("ticker, yahoo_symbol, currency, last_price").eq("id", position.stock_id).maybeSingle(),
    supabase.from("entries").select("quantity, price, date").eq("position_id", positionId),
    supabase.from("exits").select("quantity").eq("position_id", positionId),
    supabase.from("portfolio_profiles").select("objective").eq("user_id", userId).maybeSingle(),
    supabase.from("holding_watch_state").select("*").eq("position_id", positionId).maybeSingle(),
  ]);

  // Supabase resolves with an `error` field rather than throwing, so ignoring
  // these would turn a database failure into a plausible-looking answer: a
  // failed `entries` read becomes a zero-quantity position, and a failed
  // `theses` read becomes "the trader recorded no reason". Both would then be
  // written to the ledger and shown as a real read.
  for (const [what, res] of [
    ["thesis", thesisRes],
    ["stock", stockRes],
    ["entries", entriesRes],
    ["exits", exitsRes],
    ["portfolio objective", profileRes],
    ["watch state", stateRes],
  ] as const) {
    if (res.error) return { ok: false, kind: "failed", error: `Could not read the ${what}: ${res.error.message}` };
  }

  const thesis = thesisRes.data;
  const stock = stockRes.data;
  const entries = entriesRes.data ?? [];

  if (!stock?.yahoo_symbol) {
    return { ok: false, kind: "failed", error: `${position.ticker} has no resolved listing to read` };
  }

  // Exits subtracted, so a position trimmed from 100 shares to 20 is read as
  // the 20 still at risk. The drain deliberately watches `partial_exit`
  // positions, so this is the normal case for them, not an edge one.
  const exited = (exitsRes.data ?? []).reduce((sum, e) => sum + e.quantity, 0);

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
    return { ok: false, kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  const weightedAverage = computeWeightedAverageEntry(entries);
  return {
    ok: true,
    context: {
      position,
      thesis,
      stock: { ...stock, yahoo_symbol: stock.yahoo_symbol },
      entries,
      exited,
      objective: profileRes.data?.objective ?? null,
      state: stateRes.data,
      observed,
      price,
      weightedAverage,
      remaining: weightedAverage.totalQuantity - exited,
      heldSince: entries.map((e) => e.date).sort()[0] ?? null,
      rationale: statedRationale(thesis?.input_text ?? null, position.ticker),
    },
  };
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

  const loaded = await loadHoldingContext({ supabase, userId, positionId });
  if (!loaded.ok) return { status: "failed", error: loaded.error };
  const { position, observed, price, state } = loaded.context;

  const previous: WatchState = {
    fundamentals: (state?.fundamentals as Record<string, unknown> | null) ?? {},
    nextEarningsDate: state?.next_earnings_date ?? null,
    lastEarningsSeen: state?.last_earnings_seen ?? null,
  };
  const isInitial = state?.last_checked_at == null;

  const detected = detectTriggers({ state: previous, observed, today });

  /**
   * Advances the watch state. Returns an error message when it could not.
   *
   * Not fire-and-forget: if a review and its Feed row are saved but the state
   * write fails, the next hourly drain sees the same trigger against the same
   * stale snapshot and spends another model call — a duplicate review, a
   * duplicate Feed row and a duplicate line in the digest, repeating every
   * hour until it happens to succeed.
   */
  const writeState = async (checked: boolean): Promise<string | null> => {
    const now = new Date().toISOString();
    const { error } = await supabase.from("holding_watch_state").upsert(
      {
        position_id: positionId,
        user_id: userId,
        fundamentals: detected.nextState.fundamentals as Json,
        next_earnings_date: detected.nextState.nextEarningsDate,
        last_earnings_seen: detected.nextState.lastEarningsSeen,
        last_attempted_at: now,
        ...(checked ? { last_checked_at: now } : {}),
      },
      { onConflict: "position_id" },
    );
    return error ? error.message : null;
  };

  // Nothing moved and nobody asked. Record that we looked and spend nothing —
  // this is the branch that keeps a weekly watch over a large book affordable.
  if (!force && !isInitial && detected.triggers.length === 0) {
    const stateError = await writeState(true);
    if (stateError) return { status: "failed", error: stateError };
    return { status: "unchanged" };
  }

  const budget = await checkBudget(userId);
  if (!budget.ok) {
    // State is deliberately NOT advanced: this holding still needs reviewing,
    // and marking it checked would mean it silently waits another full week
    // after the trader's budget resets.
    return { status: "skipped", reason: budget.message };
  }

  // The calendar wins over a fundamentals move — an earnings date is a harder
  // fact and the more useful headline. `manual` covers a trader asking and the
  // first-ever read of a holding with nothing notable about it.
  //
  // An initial read that DOES find an earnings date keeps the calendar
  // trigger, and that is not cosmetic. Forcing it to `manual` meant a holding
  // imported with earnings the following week never reached the Feed — and
  // because the initial run had already recorded that date as seen, the next
  // weekly run would not fire on it either. The event simply vanished.
  const calendar = detected.triggers.includes("earnings_calendar");
  const trigger: HoldingReviewTrigger = calendar
    ? "earnings_calendar"
    : force || isInitial
      ? "manual"
      : (detected.triggers[0] ?? "scheduled");

  const context = buildHoldingReviewContext({
    ticker: position.ticker,
    companyName: null,
    currency: loaded.context.stock.currency,
    quantity: loaded.context.remaining,
    averagePrice: loaded.context.weightedAverage.averagePrice,
    currentPrice: price,
    rationale: loaded.context.rationale,
    objective: loaded.context.objective,
    heldSince: loaded.context.heldSince,
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

  // A Feed row for a development the watch found, never for the mere act of
  // looking. A trader-requested re-run is already on the screen they asked
  // from, and putting that in the Feed would make it a log rather than a list
  // of things needing attention — but a real earnings date or fundamentals
  // move found during an INITIAL read is exactly what the Feed is for, which
  // is why this follows the trigger rather than excluding `isInitial`.
  const flagged = !force && (trigger === "earnings_calendar" || trigger === "fundamentals_delta");
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
        earningsDateIsEstimate: observed.earningsDateIsEstimate,
        changes: detected.changes,
      }),
    });
    if (signalError) {
      // The review is saved and readable on the position page; only its Feed
      // entry is missing. Losing the review over that would be the worse trade.
      console.error("[holding-watch] review saved but not surfaced in the Feed", signalError);
    }
  }

  const stateError = await writeState(true);
  if (stateError) {
    // The review is saved and the Feed row is out; only the bookkeeping
    // failed. Reported so the caller counts it as a failure and the row is
    // retried, rather than silently re-reviewing this holding every hour.
    console.error(`[holding-watch] ${positionId} reviewed but state not advanced: ${stateError}`);
    return { status: "failed", error: `Review saved but the watch state could not be advanced: ${stateError}` };
  }
  return { status: "reviewed", trigger, reviewId: review.id, flagged };
}
