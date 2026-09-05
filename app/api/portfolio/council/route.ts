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
  aggregateByListing,
  JARVIS_PORTFOLIO_SYNTHESIS_SYSTEM_PROMPT,
  type CouncilHolding,
  type PortfolioCouncilReport,
  type PortfolioMemberOpinion,
  type PortfolioOpinion,
  type PortfolioSynthesis,
} from "@/lib/jarvis-portfolio-council";
import { getCryptoPrices } from "@/lib/crypto-data";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getFundamentals, getQuote } from "@/lib/market-data";
import { parsePortfolioParam, portfolioParamResponse, requireScopedRead } from "@/lib/portfolio/active";
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
 *
 * Runs on ONE book since 0027, never the roll-up. That is the whole point of
 * the change: a retirement book held for someone else and a personal
 * high-conviction book have different objectives, different tolerance for
 * concentration and different correct answers to "should I trim this", so a
 * verdict averaged over both is wrong for both.
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

  // After the budget check, for the same reason the body parse is: an account
  // over budget should hear that first, whatever else is wrong with the
  // request. This costs nothing either way — it reads a query string.
  const scope = parsePortfolioParam(new URL(request.url).searchParams.get("portfolio"));
  if (scope?.mode !== "one") return portfolioParamResponse();
  const portfolioId = scope.id;

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
  const { data: portfolio, error: portfolioError } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .maybeSingle();
  if (portfolioError) {
    return NextResponse.json({ error: portfolioError.message }, { status: 500 });
  }
  if (!portfolio) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id, trade_plan_id, stock_id")
    .eq("portfolio_id", portfolioId)
    .in("status", ["active", "partial_exit"]);
  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }
  if (!positions || positions.length < MIN_HOLDINGS) {
    return NextResponse.json(
      {
        error: `The Council reviews how a portfolio is built, so it needs at least ${MIN_HOLDINGS} open positions. "${portfolio.name}" has ${positions?.length ?? 0}.`,
      },
      { status: 400 },
    );
  }

  const positionIds = positions.map((p) => p.id);
  const [stocksRes, thesesRes, plansRes, entriesRes, exitsRes, profileRes] = await Promise.all([
    supabase
      .from("stocks")
      .select("id, ticker, yahoo_symbol, currency, last_price, coingecko_id, asset_class")
      .in("id", positions.map((p) => p.stock_id)),
    supabase.from("theses").select("id, input_text, source").in("id", positions.map((p) => p.thesis_id)),
    // Every field that can establish a plan, not just two of them. A position
    // with only a second target or a time exit is still planned, and telling
    // the panel it has "no stop, no targets and no time exit" would be false.
    supabase
      .from("trade_plans")
      .select("id, stop_loss, target_1, target_2, time_exit_date, time_exit_condition")
      .in("id", positions.map((p) => p.trade_plan_id)),
    supabase.from("entries").select("position_id, quantity, price").in("position_id", positionIds),
    supabase.from("exits").select("position_id, quantity").in("position_id", positionIds),
    // Keyed on the book since 0027. Reading it by user again would hand every
    // book the objective written about whichever one was imported first, which
    // is the exact failure this whole change exists to remove.
    supabase.from("portfolio_profiles").select("objective").eq("portfolio_id", portfolioId).maybeSingle(),
  ]);

  // Supabase resolves with an `error` field rather than throwing, so ignoring
  // these would let a failed read look like legitimately absent data — and the
  // route would spend N+1 model calls telling every member that positions have
  // no rationale, no plan and no objective.
  for (const [what, res] of [
    ["stocks", stocksRes],
    ["theses", thesesRes],
    ["trade plans", plansRes],
    ["entries", entriesRes],
    ["exits", exitsRes],
    ["portfolio objective", profileRes],
  ] as const) {
    if (res.error) {
      return NextResponse.json(
        { error: `Could not read your ${what}: ${res.error.message}` },
        { status: 500 },
      );
    }
  }

  const profile = profileRes.data;
  const stockById = new Map((stocksRes.data ?? []).map((s) => [s.id, s]));
  const thesisById = new Map((thesesRes.data ?? []).map((t) => [t.id, t]));
  const planById = new Map((plansRes.data ?? []).map((t) => [t.id, t]));
  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entriesRes.data ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const exitedByPosition = new Map<string, number>();
  for (const e of exitsRes.data ?? []) {
    exitedByPosition.set(e.position_id, (exitedByPosition.get(e.position_id) ?? 0) + e.quantity);
  }

  // --- 2. refresh every holding ------------------------------------------
  // Coins are priced FIRST and in a batch, because /simple/price takes every
  // id in one request. Doing it inside the fan-out below would make one call
  // per coin, and — worse — that fan-out asks Yahoo, which cannot answer for a
  // synthetic `coingecko:<id>:<currency>` symbol at all. Before this, every
  // coin in a book reached the panel as "price UNAVAILABLE" with a null
  // weight, which is precisely the holding an exposure read is about.
  const coinStocks = [...stockById.values()].filter((s) => s.coingecko_id);
  const coinPrices = new Map<string, number>();
  await Promise.all(
    [...new Set(coinStocks.map((s) => s.currency))].map(async (currency) => {
      const ids = [
        ...new Set(
          coinStocks.filter((s) => s.currency === currency).map((s) => s.coingecko_id!),
        ),
      ];
      try {
        const quotes = await getCryptoPrices(ids, currency);
        for (const [id, quote] of quotes) coinPrices.set(`${id}|${currency}`, quote.price);
      } catch {
        // Same rule as a failed Yahoo quote below: the holding is still shown,
        // with its number marked unavailable. Dropping it would flatter the
        // weights of everything else.
      }
    }),
  );

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
      // Exits subtracted: a position trimmed from 100 shares to 20 is 20
      // shares of capital, and reviewing it as 100 overstates its weight, its
      // market value and the sizing every member is asked to judge.
      const remaining = weightedAverage.totalQuantity - (exitedByPosition.get(position.id) ?? 0);
      if (remaining <= 0) return null;

      const isCoin = Boolean(stock.coingecko_id);
      // Neither call is made for a coin. Yahoo cannot answer a synthetic
      // symbol, and a coin has no fundamentals to fetch — asking anyway would
      // spend two requests per coin to receive nothing, every consult.
      const [quote, fundamentals] = isCoin
        ? [null, {} as Record<string, string | number>]
        : await Promise.all([
            // A holding that will not price is INCLUDED with its number marked
            // unavailable rather than dropped. A position nobody can value is a
            // fact about the book, and hiding it would flatter the weights of
            // everything else.
            getQuote(stock.yahoo_symbol).catch(() => null),
            getFundamentals(stock.yahoo_symbol).catch(() => ({})),
          ]);
      const coinPrice = isCoin
        ? (coinPrices.get(`${stock.coingecko_id}|${stock.currency}`) ?? null)
        : null;
      const thesis = thesisById.get(position.thesis_id);
      const plan = planById.get(position.trade_plan_id);

      return {
        ticker: position.ticker,
        companyName: quote?.name ?? null,
        currency: stock.currency,
        assetClass: stock.asset_class ?? "equity",
        quantity: remaining,
        averagePrice: weightedAverage.averagePrice,
        // NULL when the live fetch failed, deliberately — not the cached
        // `last_price`. This consult's whole premise is that every holding was
        // re-priced just now, and quietly substituting a stored number would
        // stamp a stale quote with a fresh `as_of` and let it carry a weight
        // as though it were live. Unavailable is the honest answer.
        currentPrice: isCoin ? coinPrice : (quote?.price ?? null),
        fundamentals,
        rationale: rationaleFor(thesis, position.ticker),
        hasTradePlan:
          plan != null &&
          (plan.stop_loss != null ||
            plan.target_1 != null ||
            plan.target_2 != null ||
            plan.time_exit_date != null ||
            plan.time_exit_condition != null),
        imported: thesis?.source === "imported",
      };
    },
  );

  // Aggregated before weighting: two positions in the same listing are one
  // holding as far as concentration is concerned.
  const book = aggregateByListing(holdings.filter((h): h is CouncilHolding => h !== null));
  if (book.length < MIN_HOLDINGS) {
    return NextResponse.json(
      {
        error:
          "There aren't enough distinct holdings here to review how the portfolio is built — two positions in the same listing are one holding.",
      },
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
    book: portfolio,
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
  // Why there is no combined read, when there is none. "Fewer than two
  // answered" and "the synthesis call failed" are different facts, and telling
  // a trader the first when the second happened contradicts the tally they can
  // see immediately above it.
  let synthesisSkipped: "too_few" | "failed" | null = answered.length < 2 ? "too_few" : null;
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
      else synthesisSkipped = "failed";
    } catch {
      // A failed synthesis costs the summary block only. Every member card
      // still renders.
      synthesis = null;
      synthesisSkipped = "failed";
    }
  }

  const report: PortfolioCouncilReport = normalizePortfolioCouncilReport(
    {
      opinions,
      synthesis,
      synthesis_skipped: synthesis ? null : synthesisSkipped,
      generated_at: new Date().toISOString(),
    },
    book.map((h) => h.ticker),
  );

  // --- 5. persist --------------------------------------------------------
  // INSERT, never upsert: re-running is a new entry so two dates can be
  // compared. See the migration.
  const { data: saved, error: saveError } = await supabase
    .from("portfolio_council_reports")
    .insert({
      user_id: user.id,
      portfolio_id: portfolioId,
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

/** How many consults one page of history returns. */
const HISTORY_PAGE = 20;

/**
 * Past consults, newest first.
 *
 * Paged rather than capped. The table is append-only precisely so a trader can
 * compare what the Council said about the same book at two points in time, and
 * an unconditional `limit` would make every report past the twentieth
 * unreachable — quietly defeating the one reason the rows are kept.
 * `?before=<ISO timestamp>` walks backwards from there.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const scope = await requireScopedRead(request, supabase);
  if (scope instanceof Response) return scope;

  const before = new URL(request.url).searchParams.get("before");

  let query = supabase
    .from("portfolio_council_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(HISTORY_PAGE);
  // The roll-up shows every book's history: a consult is stamped with the book
  // it judged, so mixing them loses nothing and answers "when did I last have
  // anything looked at" in one read.
  if (scope.mode === "one") query = query.eq("portfolio_id", scope.id);
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reports = data ?? [];
  return NextResponse.json({
    reports,
    // Null when this is the last page, so the client knows to stop offering.
    nextBefore: reports.length === HISTORY_PAGE ? reports[reports.length - 1].created_at : null,
  });
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
