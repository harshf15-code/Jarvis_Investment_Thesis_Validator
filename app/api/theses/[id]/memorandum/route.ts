import { NextResponse } from "next/server";

import {
  buildMemorandumUserContext,
  buildPeerShortlistUserContext,
  parseMemorandum,
  JARVIS_MEMORANDUM_SYSTEM_PROMPT,
  type MemoCandidateInput,
} from "@/lib/jarvis-memorandum";
import {
  buildCandidateShortlistUserContext,
  JARVIS_CANDIDATE_SHORTLIST_SYSTEM_PROMPT,
} from "@/lib/jarvis-thesis-prompt";
import { currentUser } from "@/lib/auth/user";
import { parseCandidateShortlist } from "@/lib/jarvis-thesis-parser";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getFundamentals, getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { MARKETS, currencyForExchange, exchangesFor, isLiveMarket } from "@/lib/markets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ExchangeCode, MarketCode, ThesisCandidateInsert } from "@/lib/types";

// Two model calls plus up to five live Yahoo lookups.
export const maxDuration = 180;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asNumber(value: string | number | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type Resolved = {
  ticker: string;
  companyName: string | null;
  exchange: ExchangeCode | null;
  yahooSymbol: string | null;
  price: number | null;
  priceAsOf: Date | null;
  currency: string | null;
  fundamentals: Record<string, string | number>;
};

/**
 * Probes only the exchanges belonging to the market this run is for.
 *
 * A miss now means something specific and actionable: the model named a company
 * that is not listed in the trader's chosen universe. Rather than carrying it
 * into the memo as an unpriced column — which is how a robotics thesis ended up
 * comparing two US names against three unpriceable Japanese ones, and picking
 * from whichever happened to survive — the caller drops it and asks again.
 */
async function resolveCandidate(
  ticker: string,
  companyName: string | null,
  exchanges: readonly ExchangeCode[],
): Promise<Resolved> {
  for (const exchange of exchanges) {
    const yahooSymbol = resolveYahooSymbol(ticker, exchange);
    try {
      const [quote, fundamentals] = await Promise.all([
        getQuote(yahooSymbol),
        getFundamentals(yahooSymbol).catch(() => ({})),
      ]);
      // Priced in the wrong money means this is a different listing to the one
      // the chosen market means — see the note in `app/api/theses/route.ts`.
      // A candidate that reaches the comparative grid in another currency is
      // compared against its peers as if the numbers were the same money.
      if (quote.currency != null && quote.currency !== currencyForExchange(exchange)) {
        continue;
      }
      return {
        ticker,
        companyName,
        exchange,
        yahooSymbol,
        price: quote.price,
        priceAsOf: quote.asOf,
        currency: quote.currency ?? currencyForExchange(exchange),
        fundamentals,
      };
    } catch {
      continue;
    }
  }
  return {
    ticker,
    companyName,
    exchange: null,
    yahooSymbol: null,
    price: null,
    priceAsOf: null,
    currency: null,
    fundamentals: {},
  };
}

/**
 * Generates the full decision memorandum for a thesis: shortlist -> live market
 * data for every name -> one memorandum call -> persist.
 *
 * Works from either direction, which is the point. A macro thesis ("NBFCs have
 * all-time-low NPAs") gets a basket Jarvis chooses; a thesis that already names
 * a stock gets that stock plus its closest peers, because "should I buy this
 * one" is only answerable against the alternatives.
 *
 * Replaces the memo on every run rather than versioning — the memo is a current
 * read on a live market, and a stale one is worse than none.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Spend guard. Runs before any model call and before the live market lookups
  // below, so an account that is over budget costs nothing at all.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const budget = await checkBudget();
  if (!budget.ok) {
    // 503 when spend is unknown, 429 when it is known to be exhausted — a
    // caller should retry the first and not the second.
    const status = budget.window === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: budget.message }, { status });
  }
  // Re-bound for the same reason as `t` below: the shortlist closures are
  // function declarations, inside which TypeScript widens `user` back to `| null`.
  const userId = user.id;

  const { data: thesis, error: thesisError } = await supabase
    .from("theses")
    .select("*")
    .eq("id", id)
    .single();
  if (thesisError || !thesis) {
    return NextResponse.json({ error: thesisError?.message ?? "Thesis not found" }, { status: 404 });
  }

  // Re-bound after the guard above: the closures below are function
  // declarations, and TypeScript widens `thesis` back to `| null` inside them.
  const t = thesis;

  // One run analyses exactly one market. A thesis selected for several markets
  // produces one memorandum per market, each with its own shortlist, prices and
  // pick — because "the best robotics name in India" and "…in the US" are
  // different questions with different answers.
  const requested = new URL(request.url).searchParams.get("market");
  const market = (requested ?? t.markets?.[0] ?? "US") as MarketCode;
  if (!isLiveMarket(market)) {
    return NextResponse.json({ error: `Market "${market}" is not available yet.` }, { status: 400 });
  }
  if (!t.markets?.includes(market)) {
    return NextResponse.json(
      { error: `This thesis was not created for ${MARKETS[market].label}.` },
      { status: 400 },
    );
  }
  const exchanges = exchangesFor(market);

  // --- 1. Shortlist ------------------------------------------------------
  // Runs at most twice. The second attempt only happens when the first came
  // back with too few names that are actually listed in this market, and it is
  // told which tickers were rejected — otherwise it just re-rolls the same
  // foreign names it already offered.
  async function shortlistOnce(rejected?: string[]) {
    const result = await meteredGenerateText({
      userId,
      feature: "memorandum",
      thesisId: id,
      system: JARVIS_CANDIDATE_SHORTLIST_SYSTEM_PROMPT,
      prompt: t.ticker
        ? buildPeerShortlistUserContext(
            { input_text: t.input_text, ticker: t.ticker, market_view: t.market_view },
            market,
          )
        : buildCandidateShortlistUserContext(t, market, rejected),
    });
    return parseCandidateShortlist(result.text);
  }

  /**
   * Turns a shortlist into priced candidates, dropping anything that will not
   * resolve on this market's exchanges.
   *
   * `thesis.ticker` is seeded first and exempt from the drop — but only because
   * `app/api/theses/route.ts` now guarantees it is a ticker the TRADER named
   * and that already resolved. It is no longer possible for a name the model
   * invented to claim this slot.
   */
  async function priceShortlist(
    tickers: { ticker: string; company_name?: string | null }[],
  ) {
    const seen = new Set<string>();
    const wanted: { ticker: string; company_name: string | null }[] = [];
    if (t.ticker) {
      seen.add(t.ticker.toUpperCase());
      wanted.push({ ticker: t.ticker.toUpperCase(), company_name: null });
    }
    for (const c of tickers) {
      const key = c.ticker.trim().toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      wanted.push({ ticker: key, company_name: c.company_name ?? null });
    }
    // The grid is built for five columns.
    const all = await Promise.all(
      wanted.slice(0, 5).map((c) => resolveCandidate(c.ticker, c.company_name, exchanges)),
    );
    return {
      priced: all.filter((r) => r.price !== null),
      rejected: all.filter((r) => r.price === null).map((r) => r.ticker),
    };
  }

  const shortlist = await shortlistOnce().catch(() => null);
  if (shortlist && !shortlist.ok) {
    return NextResponse.json(
      { error: `Could not read Jarvis's shortlist: ${shortlist.error}` },
      { status: 502 },
    );
  }
  if (!shortlist) {
    return NextResponse.json({ error: "Candidate shortlist call failed" }, { status: 502 });
  }

  let { priced, rejected } = await priceShortlist(shortlist.data.candidates);

  // Too thin to be a comparison. Ask once more, naming what was rejected.
  if (priced.length < 3 && rejected.length > 0) {
    const retry = await shortlistOnce(rejected).catch(() => null);
    if (retry?.ok) {
      const second = await priceShortlist(retry.data.candidates);
      if (second.priced.length > priced.length) {
        priced = second.priced;
        rejected = [...new Set([...rejected, ...second.rejected])];
      }
    }
  }

  if (priced.length === 0) {
    return NextResponse.json(
      {
        error: `Jarvis could not find any ${MARKETS[market].label}-listed name it could price for this thesis${
          rejected.length ? ` (tried: ${rejected.join(", ")})` : ""
        }. Try another market, or rephrase the thesis.`,
      },
      { status: 422 },
    );
  }

  // --- 2. Live market data ----------------------------------------------
  // Already fetched above; every survivor has a real price by construction.
  const resolved = priced;

  // --- 3. One memorandum call -------------------------------------------
  const memoInputs: MemoCandidateInput[] = resolved.map((r) => ({
    ticker: r.ticker,
    companyName: r.companyName,
    exchange: r.exchange,
    price: r.price,
    fundamentals: r.fundamentals,
  }));

  let memoRaw: string;
  try {
    const result = await meteredGenerateText({
      userId,
      feature: "memorandum",
      thesisId: id,
      system: JARVIS_MEMORANDUM_SYSTEM_PROMPT,
      prompt: buildMemorandumUserContext({
        thesis,
        candidates: memoInputs,
        todayIso: new Date().toISOString().slice(0, 10),
      }),
    });
    memoRaw = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Memorandum call failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }

  const parsed = parseMemorandum(memoRaw);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `Could not read Jarvis's memorandum: ${parsed.error}` },
      { status: 502 },
    );
  }

  // Keep only names we actually priced — the model occasionally adds a column
  // for a ticker that was never in the shortlist.
  const byTicker = new Map(resolved.map((r) => [r.ticker, r]));
  const memo = {
    ...parsed.data,
    candidates: parsed.data.candidates.filter((c) => byTicker.has(c.ticker.trim().toUpperCase())),
  };
  if (memo.candidates.length === 0) {
    return NextResponse.json(
      { error: "Jarvis's memorandum did not cover any of the shortlisted candidates." },
      { status: 502 },
    );
  }

  // --- 4. Persist --------------------------------------------------------
  // Candidate rows go through `supabase` (the user's client) so RLS stamps and
  // checks their owner. The `stocks` writes below cannot: it is a shared cache
  // that `authenticated` may only read (0014), so maintaining it is a
  // service-role job.
  const stocksAdmin = createAdminClient();
  const stockIdByTicker = new Map<string, string>();
  for (const r of resolved) {
    if (!r.yahooSymbol || !r.exchange) continue;
    const { data: existing } = await supabase
      .from("stocks")
      .select("id")
      .eq("yahoo_symbol", r.yahooSymbol)
      .maybeSingle();
    if (existing) {
      stockIdByTicker.set(r.ticker, existing.id);
      await stocksAdmin
        .from("stocks")
        .update({
          last_price: r.price,
          last_price_at: r.priceAsOf?.toISOString() ?? null,
          // Re-asserted from the quote — see the note in prices/refresh.
          ...(r.currency ? { currency: r.currency } : {}),
        })
        .eq("id", existing.id);
      continue;
    }
    const { data: created } = await stocksAdmin
      .from("stocks")
      .insert({
        ticker: r.ticker,
        yahoo_symbol: r.yahooSymbol,
        exchange: r.exchange,
        currency: r.currency ?? currencyForExchange(r.exchange),
        last_price: r.price,
        last_price_at: r.priceAsOf?.toISOString() ?? null,
      })
      .select("id")
      .single();
    if (created) stockIdByTicker.set(r.ticker, created.id);
  }

  // The memo's own ordering is the ranking: the pick leads, then the rest as
  // Jarvis laid them out.
  const ordered = [...memo.candidates].sort(
    (a, b) => Number(b.is_primary_pick) - Number(a.is_primary_pick),
  );

  // Scoped to this market: without the second filter, running India would wipe
  // the US run's candidates and leave that memorandum pointing at rows that no
  // longer exist.
  await supabase.from("thesis_candidates").delete().eq("thesis_id", id).eq("market", market);

  const rows: ThesisCandidateInsert[] = ordered.map((c, i) => {
    const ticker = c.ticker.trim().toUpperCase();
    const r = byTicker.get(ticker)!;
    const f = r.fundamentals;
    return {
      thesis_id: id,
      market,
      ticker,
      company_name: c.company_name ?? r.companyName,
      stock_id: stockIdByTicker.get(ticker) ?? null,
      yahoo_symbol: r.yahooSymbol,
      exchange: r.exchange,
      rank: i + 1,
      verdict: c.verdict === "BUY" ? "bet" : c.verdict === "AVOID" ? "avoid" : "watch",
      tagline: c.tagline,
      operational_share: c.operational_share,
      valuation_metric: c.valuation_metric,
      market_cap: c.market_cap,
      // Straight from Yahoo, not from the model — these drive the grid's
      // range bar, so they must be the real numbers.
      range_low: asNumber(f.fiftyTwoWeekLow),
      range_high: asNumber(f.fiftyTwoWeekHigh),
      cmp: r.price,
      fundamentals: f,
    };
  });

  const { data: candidates, error: insertError } = await supabase
    .from("thesis_candidates")
    .insert(rows)
    .select("*")
    .order("rank", { ascending: true });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const candidateIdByTicker = new Map((candidates ?? []).map((c) => [c.ticker, c.id]));
  const primaryCandidateId = candidateIdByTicker.get(memo.primary_ticker) ?? null;
  const secondaryCandidateId = memo.secondary_ticker
    ? candidateIdByTicker.get(memo.secondary_ticker.trim().toUpperCase()) ?? null
    : null;

  const { data: memorandum, error: memoError } = await supabase
    .from("thesis_memorandums")
    .upsert(
      {
        thesis_id: id,
        market,
        sector_theme: memo.header.sector_theme,
        memo_title: memo.header.title,
        data_source: memo.header.data_source,
        primary_candidate_id: primaryCandidateId,
        secondary_candidate_id: secondaryCandidateId,
        conviction_score: memo.thesis.conviction_score,
        document: memo,
        raw_llm_response: memoRaw,
      },
      { onConflict: "thesis_id,market" },
    )
    .select("*")
    .single();
  if (memoError) {
    return NextResponse.json({ error: memoError.message }, { status: 500 });
  }

  return NextResponse.json({ market, memorandum, candidates: candidates ?? [] });
}

/** Reads a previously-generated memorandum without spending model calls. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Defaults to the thesis's first market so an older link without the param
  // still resolves to a real report rather than an empty one.
  const requested = new URL(request.url).searchParams.get("market");
  const { data: thesis } = await supabase.from("theses").select("markets").eq("id", id).single();
  const market = (requested ?? thesis?.markets?.[0] ?? "US") as MarketCode;

  const { data: memorandum } = await supabase
    .from("thesis_memorandums")
    .select("*")
    .eq("thesis_id", id)
    .eq("market", market)
    .maybeSingle();

  const { data: candidates, error } = await supabase
    .from("thesis_candidates")
    .select("*")
    .eq("thesis_id", id)
    .eq("market", market)
    .order("rank", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    market,
    markets: thesis?.markets ?? [market],
    memorandum: memorandum ?? null,
    candidates: candidates ?? [],
  });
}
