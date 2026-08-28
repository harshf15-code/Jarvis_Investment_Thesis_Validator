import { NextResponse } from "next/server";
import { generateText } from "ai";

import {
  buildCandidateAnalysisUserContext,
  buildCandidateShortlistUserContext,
  JARVIS_CANDIDATE_ANALYSIS_SYSTEM_PROMPT,
  JARVIS_CANDIDATE_SHORTLIST_SYSTEM_PROMPT,
  type CandidateMarketSnapshot,
} from "@/lib/jarvis-thesis-prompt";
import {
  normalizeCandidateRanks,
  parseCandidateAnalysis,
  parseCandidateShortlist,
} from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { getFundamentals, getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExchangeCode, ThesisCandidateInsert } from "@/lib/types";

// Two sequential model calls plus N live Yahoo lookups.
export const maxDuration = 120;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ResolvedCandidate = {
  ticker: string;
  companyName: string | null;
  exchange: ExchangeCode | null;
  yahooSymbol: string | null;
  price: number | null;
  priceAsOf: Date | null;
  fundamentals: Record<string, string | number>;
};

/**
 * Same NSE-then-US probe as `POST /api/theses` uses for a single ticker (there
 * is no exchange-detection signal in this app, so both are simply tried in a
 * fixed order). Unlike that route, a miss here is NOT fatal: the candidate is
 * still analysed and shown, flagged as unpriced, because "Jarvis looked at this
 * name and couldn't price it" is a result worth seeing.
 */
async function resolveCandidate(
  ticker: string,
  companyName: string | null,
): Promise<ResolvedCandidate> {
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
 * Runs the bake-off for a thesis that named no stock: shortlist -> resolve live
 * market data for every name -> one comparative ranking call -> persist.
 *
 * Idempotent by replacement — re-posting re-runs the analysis and swaps the
 * stored candidate set, which is what the "Re-run" affordance in the UI needs.
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
      prompt: buildCandidateShortlistUserContext(thesis),
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

  // De-duplicate case-insensitively before spending a Yahoo lookup on each.
  const seen = new Set<string>();
  const wanted = shortlist.data.candidates.filter((c) => {
    const key = c.ticker.trim().toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // --- 2. Live market data for every candidate ---------------------------
  const resolved = await Promise.all(
    wanted.map((c) => resolveCandidate(c.ticker.trim().toUpperCase(), c.company_name ?? null)),
  );

  // --- 3. One comparative ranking call -----------------------------------
  const snapshots: CandidateMarketSnapshot[] = resolved.map((r) => ({
    ticker: r.ticker,
    companyName: r.companyName,
    yahooSymbol: r.yahooSymbol,
    exchange: r.exchange,
    price: r.price,
    fundamentals: r.fundamentals,
  }));

  let analysisRaw: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_CANDIDATE_ANALYSIS_SYSTEM_PROMPT,
      prompt: buildCandidateAnalysisUserContext({ thesis, candidates: snapshots }),
    });
    analysisRaw = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Candidate analysis call failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }

  const analysis = parseCandidateAnalysis(analysisRaw);
  if (!analysis.ok) {
    return NextResponse.json(
      { error: `Could not read Jarvis's comparison: ${analysis.error}` },
      { status: 502 },
    );
  }

  // Keep only names we actually sent — the model occasionally invents an extra
  // one, and an unpriced ticker we never resolved must not reach the UI.
  const byTicker = new Map(resolved.map((r) => [r.ticker, r]));
  const ranked = normalizeCandidateRanks(
    analysis.data.candidates.filter((c) => byTicker.has(c.ticker.trim().toUpperCase())),
  );
  if (ranked.length === 0) {
    return NextResponse.json(
      { error: "Jarvis's comparison did not cover any of the shortlisted candidates." },
      { status: 502 },
    );
  }

  // --- 4. Persist --------------------------------------------------------
  // Upsert a `stocks` row for every candidate that priced, so picking a winner
  // later is a plain foreign-key set rather than a second round of lookups.
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

  // Replace rather than merge: a re-run is a fresh opinion, and leaving stale
  // rows behind would let a dropped candidate linger with an obsolete rank.
  await supabase.from("thesis_candidates").delete().eq("thesis_id", id);

  const rows: ThesisCandidateInsert[] = ranked.map((c) => {
    const ticker = c.ticker.trim().toUpperCase();
    const r = byTicker.get(ticker)!;
    return {
      thesis_id: id,
      ticker,
      company_name: r.companyName,
      stock_id: stockIdByTicker.get(ticker) ?? null,
      yahoo_symbol: r.yahooSymbol,
      exchange: r.exchange,
      rank: c.rank,
      verdict: c.verdict,
      score: c.score,
      fit_rationale: c.fit_rationale,
      bull_case: c.bull_case,
      bear_case: c.bear_case,
      cmp: r.price,
      fundamentals: r.fundamentals,
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

  return NextResponse.json({
    candidates: candidates ?? [],
    comparativeVerdict: analysis.data.comparative_verdict,
  });
}

/** Reads a previously-run bake-off without spending another model call. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: candidates, error } = await supabase
    .from("thesis_candidates")
    .select("*")
    .eq("thesis_id", id)
    .order("rank", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ candidates: candidates ?? [] });
}
