import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { MAX_CONCURRENT_QUOTES, mapWithConcurrency } from "@/lib/concurrency";
import { COUNCIL_CONSULT_MIN, COUNCIL_ROSTER_MAX } from "@/lib/jarvis-council";
import {
  buildPortfolioOpinionSystemPrompt,
  buildPortfolioOpinionUserContext,
  buildPortfolioSynthesisUserContext,
  normalizePortfolioCouncilReport,
  parsePortfolioOpinion,
  parsePortfolioSynthesis,
  splitByCurrency,
  JARVIS_PORTFOLIO_SYNTHESIS_SYSTEM_PROMPT,
  type CouncilHolding,
  type PortfolioCouncilReport,
  type PortfolioMemberOpinion,
  type PortfolioOpinion,
  type PortfolioSynthesis,
} from "@/lib/jarvis-portfolio-council";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getFundamentals, getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";

/**
 * The Investment Council, consulted on the whole book.
 *
 * Costs N+1 model calls like the thesis-level consult, PLUS a live price and
 * fundamentals fetch per holding — because "what would my advisor say about
 * this portfolio" is a question about today, and answering it from whatever
 * price happened to be cached would be answering a different question. That
 * makes this consult meaningfully slower and costlier than a thesis one, which
 * is why the confirm step says so before the trader commits to it.
 */
export const maxDuration = 300;

/** Below this the book has no construction to judge — it has a position. */
const MIN_HOLDINGS = 2;

const ConsultInputSchema = z.object({
  member_ids: z
    .array(z.uuid())
    .min(COUNCIL_CONSULT_MIN, `Pick at least ${COUNCIL_CONSULT_MIN} council members.`)
    .max(COUNCIL_ROSTER_MAX)
    .refine((ids) => new Set(ids).size === ids.length, "Each member may only be picked once."),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Before the body is parsed, exactly as the thesis Council does: an account
  // over budget must cost zero, not "one more consult's worth".
  const budget = await checkBudget();
  if (!budget.ok) {
    const status = budget.window === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: budget.message }, { status });
  }

  const json = await request.json().catch(() => null);
  const parsedInput = ConsultInputSchema.safeParse(json);
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: z.flattenError(parsedInput.error) },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // --- 1. the book -------------------------------------------------------
  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id, trade_plan_id, stock_id")
    .in("status", ["active", "partial_exit"]);
  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }
  if (!positions || positions.length < MIN_HOLDINGS) {
    return NextResponse.json(
      {
        error: `The Council reviews how a portfolio is built, so it needs at least ${MIN_HOLDINGS} open positions. You have ${positions?.length ?? 0}.`,
      },
      { status: 400 },
    );
  }

  const [{ data: stocks }, { data: theses }, { data: tradePlans }, { data: entries }, { data: profile }] =
    await Promise.all([
      supabase.from("stocks").select("id, ticker, yahoo_symbol, currency, last_price").in("id", positions.map((p) => p.stock_id)),
      supabase.from("theses").select("id, input_text, source").in("id", positions.map((p) => p.thesis_id)),
      supabase.from("trade_plans").select("id, stop_loss, target_1").in("id", positions.map((p) => p.trade_plan_id)),
      supabase.from("entries").select("position_id, quantity, price").in("position_id", positions.map((p) => p.id)),
      supabase.from("portfolio_profiles").select("objective").eq("user_id", user.id).maybeSingle(),
    ]);

  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));
  const planById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }

  // --- 2. refresh every holding ------------------------------------------
  // The expensive half of this consult, and the half the PRD is explicit
  // about: not whatever was last cached. Bounded at MAX_CONCURRENT_QUOTES so a
  // forty-name book does not open forty sockets at Yahoo.
  const holdings = await mapWithConcurrency(
    positions,
    MAX_CONCURRENT_QUOTES,
    async (position): Promise<CouncilHolding | null> => {
      const stock = stockById.get(position.stock_id);
      if (!stock?.yahoo_symbol) return null;
      const weightedAverage = computeWeightedAverageEntry(entriesByPosition.get(position.id) ?? []);
      if (weightedAverage.totalQuantity <= 0) return null;

      const [quote, fundamentals] = await Promise.all([
        // A holding that will not price is INCLUDED with its number marked
        // unavailable rather than dropped. A position nobody can value is a
        // fact about the book, and hiding it would flatter the weights of
        // everything else.
        getQuote(stock.yahoo_symbol).catch(() => null),
        getFundamentals(stock.yahoo_symbol).catch(() => ({})),
      ]);
      const thesis = thesisById.get(position.thesis_id);
      const plan = planById.get(position.trade_plan_id);

      return {
        ticker: position.ticker,
        companyName: quote?.name ?? null,
        currency: stock.currency,
        quantity: weightedAverage.totalQuantity,
        averagePrice: weightedAverage.averagePrice,
        currentPrice: quote?.price ?? stock.last_price ?? null,
        fundamentals,
        rationale: rationaleFor(thesis, position.ticker),
        hasTradePlan: plan?.stop_loss != null || plan?.target_1 != null,
        imported: thesis?.source === "imported",
      };
    },
  );

  const book = holdings.filter((h): h is CouncilHolding => h !== null);
  if (book.length < MIN_HOLDINGS) {
    return NextResponse.json(
      { error: "Not enough of your positions could be valued to review how the portfolio is built." },
      { status: 400 },
    );
  }

  // --- 3. the panel ------------------------------------------------------
  // RLS is what scopes this to the trader's own roster.
  const { data: members, error: membersError } = await supabase
    .from("council_members")
    .select("id, name, philosophy, source")
    .in("id", parsedInput.data.member_ids)
    .order("sort_order", { ascending: true });
  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }
  if (!members || members.length !== parsedInput.data.member_ids.length) {
    return NextResponse.json(
      { error: "One or more of the chosen council members no longer exists." },
      { status: 400 },
    );
  }

  const books = splitByCurrency(book);
  const sharedContext = buildPortfolioOpinionUserContext({
    books,
    objective: profile?.objective ?? null,
    totalPositions: book.length,
  });

  const settled = await Promise.allSettled(
    members.map(async (m): Promise<PortfolioOpinion> => {
      const result = await meteredGenerateText({
        userId: user.id,
        feature: "portfolio_council_opinion",
        system: buildPortfolioOpinionSystemPrompt(m),
        prompt: sharedContext,
      });
      const parsed = parsePortfolioOpinion(result.text);
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.data;
    }),
  );

  // A failed member gets a card carrying the reason, never a blank one.
  const opinions: PortfolioMemberOpinion[] = members.map((m, i) => {
    const outcome = settled[i];
    return outcome.status === "fulfilled"
      ? { member_id: m.id, member_name: m.name, source: m.source, opinion: outcome.value, error: null }
      : {
          member_id: m.id,
          member_name: m.name,
          source: m.source,
          opinion: null,
          error: errorMessage(outcome.reason),
        };
  });

  const answered = opinions.filter((o) => o.opinion !== null);
  if (answered.length === 0) {
    return NextResponse.json(
      { error: "Every council member's call failed. Nothing was saved." },
      { status: 502 },
    );
  }

  // --- 4. synthesis ------------------------------------------------------
  let synthesis: PortfolioSynthesis | null = null;
  let synthesisRaw = "";
  // Below two answers there is nothing to synthesise: spending a model call to
  // restate one card would be spend without information.
  if (answered.length >= 2) {
    try {
      const result = await meteredGenerateText({
        userId: user.id,
        feature: "portfolio_council_synthesis",
        system: JARVIS_PORTFOLIO_SYNTHESIS_SYSTEM_PROMPT,
        prompt: buildPortfolioSynthesisUserContext(
          answered.map((o) => ({ name: o.member_name, opinion: o.opinion! })),
        ),
      });
      synthesisRaw = result.text;
      const parsed = parsePortfolioSynthesis(result.text);
      if (parsed.ok) synthesis = parsed.data;
    } catch {
      // A failed synthesis costs the summary block only. Every member card
      // still renders.
      synthesis = null;
    }
  }

  const report: PortfolioCouncilReport = normalizePortfolioCouncilReport(
    { opinions, synthesis, generated_at: new Date().toISOString() },
    book.map((h) => h.ticker),
  );

  // --- 5. persist --------------------------------------------------------
  // INSERT, never upsert: re-running is a new entry so two dates can be
  // compared. See the migration.
  const { data: saved, error: saveError } = await supabase
    .from("portfolio_council_reports")
    .insert({
      user_id: user.id,
      document: report as unknown as Json,
      holdings_snapshot: {
        as_of: new Date().toISOString(),
        books: books.map((b) => ({
          currency: b.currency,
          cost_basis: b.costBasis,
          market_value: b.marketValue,
          holdings: b.holdings.map((h) => ({
            ticker: h.ticker,
            quantity: h.quantity,
            average_price: h.averagePrice,
            current_price: h.currentPrice,
            weight_pct: h.weightPct,
            imported: h.imported,
          })),
        })),
      } as unknown as Json,
      raw_llm_response: synthesisRaw || null,
    })
    .select("*")
    .single();

  if (saveError || !saved) {
    return NextResponse.json(
      { error: saveError?.message ?? "The council answered but the report could not be saved." },
      { status: 500 },
    );
  }

  return NextResponse.json({ report: saved }, { status: 201 });
}

/** Past consults, newest first. */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_council_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}

/**
 * The trader's own words, or null — an import writes a placeholder into
 * `theses.input_text` because the column is NOT NULL, and feeding that to a
 * persona as a stated reason would have them assess "Imported holding — INFY".
 */
function rationaleFor(
  thesis: { input_text: string; source: string } | undefined,
  ticker: string,
): string | null {
  if (!thesis?.input_text) return null;
  const placeholder = `Imported holding — ${ticker}. No stated reason recorded at import.`;
  return thesis.input_text.trim() === placeholder ? null : thesis.input_text;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
