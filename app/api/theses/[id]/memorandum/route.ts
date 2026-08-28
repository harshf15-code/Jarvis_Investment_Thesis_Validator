import { NextResponse } from "next/server";
import { generateText } from "ai";

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
import { parseCandidateShortlist } from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { getFundamentals, getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExchangeCode, ThesisCandidateInsert } from "@/lib/types";

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
  fundamentals: Record<string, string | number>;
};

/**
 * NSE then US, same fixed probe order the rest of the app uses (there is no
 * exchange-detection signal here). A miss is not fatal — the candidate is still
 * carried into the memo, flagged as unpriced, because "Jarvis weighed this and
 * couldn't price it" is a result the grid should show.
 */
async function resolveCandidate(ticker: string, companyName: string | null): Promise<Resolved> {
  for (const exchange of ["NSE", "US"] as const) {
    const yahooSymbol = resolveYahooSymbol(ticker, exchange);
    try {
      const [quote, fundamentals] = await Promise.all([
        getQuote(yahooSymbol),
        getFundamentals(yahooSymbol).catch(() => ({})),
      ]);
      return {
        ticker,
        companyName,
        exchange,
        yahooSymbol,
        price: quote.price,
        priceAsOf: quote.asOf,
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
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: thesis, error: thesisError } = await supabase
    .from("theses")
    .select("*")
    .eq("id", id)
    .single();
  if (thesisError || !thesis) {
    return NextResponse.json({ error: thesisError?.message ?? "Thesis not found" }, { status: 404 });
  }

  // --- 1. Shortlist ------------------------------------------------------
  let shortlistRaw: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_CANDIDATE_SHORTLIST_SYSTEM_PROMPT,
      prompt: thesis.ticker
        ? buildPeerShortlistUserContext({
            input_text: thesis.input_text,
            ticker: thesis.ticker,
            market_view: thesis.market_view,
          })
        : buildCandidateShortlistUserContext(thesis),
    });
    shortlistRaw = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Candidate shortlist call failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }

  const shortlist = parseCandidateShortlist(shortlistRaw);
  if (!shortlist.ok) {
    return NextResponse.json(
      { error: `Could not read Jarvis's shortlist: ${shortlist.error}` },
      { status: 502 },
    );
  }

  const seen = new Set<string>();
  const wanted: { ticker: string; company_name: string | null }[] = [];
  // Seed the trader's own stock first so it is never dropped by a shortlist
  // that forgot to echo it back.
  if (thesis.ticker) {
    seen.add(thesis.ticker.toUpperCase());
    wanted.push({ ticker: thesis.ticker.toUpperCase(), company_name: null });
  }
  for (const c of shortlist.data.candidates) {
    const key = c.ticker.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    wanted.push({ ticker: key, company_name: c.company_name ?? null });
  }
  // The grid is built for five columns.
  const shortlisted = wanted.slice(0, 5);

  // --- 2. Live market data ----------------------------------------------
  const resolved = await Promise.all(
    shortlisted.map((c) => resolveCandidate(c.ticker, c.company_name)),
  );

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
    const result = await generateText({
      model: jarvisModel,
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
      await supabase
        .from("stocks")
        .update({ last_price: r.price, last_price_at: r.priceAsOf?.toISOString() ?? null })
        .eq("id", existing.id);
      continue;
    }
    const { data: created } = await supabase
      .from("stocks")
      .insert({
        ticker: r.ticker,
        yahoo_symbol: r.yahooSymbol,
        exchange: r.exchange,
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

  await supabase.from("thesis_candidates").delete().eq("thesis_id", id);

  const rows: ThesisCandidateInsert[] = ordered.map((c, i) => {
    const ticker = c.ticker.trim().toUpperCase();
    const r = byTicker.get(ticker)!;
    const f = r.fundamentals;
    return {
      thesis_id: id,
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
        sector_theme: memo.header.sector_theme,
        memo_title: memo.header.title,
        data_source: memo.header.data_source,
        primary_candidate_id: primaryCandidateId,
        secondary_candidate_id: secondaryCandidateId,
        conviction_score: memo.thesis.conviction_score,
        document: memo,
        raw_llm_response: memoRaw,
      },
      { onConflict: "thesis_id" },
    )
    .select("*")
    .single();
  if (memoError) {
    return NextResponse.json({ error: memoError.message }, { status: 500 });
  }

  return NextResponse.json({ memorandum, candidates: candidates ?? [] });
}

/** Reads a previously-generated memorandum without spending model calls. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: memorandum } = await supabase
    .from("thesis_memorandums")
    .select("*")
    .eq("thesis_id", id)
    .maybeSingle();

  const { data: candidates, error } = await supabase
    .from("thesis_candidates")
    .select("*")
    .eq("thesis_id", id)
    .order("rank", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ memorandum: memorandum ?? null, candidates: candidates ?? [] });
}
