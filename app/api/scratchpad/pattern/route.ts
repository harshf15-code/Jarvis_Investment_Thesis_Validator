import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/user";
import { MAX_CONCURRENT_QUOTES, mapWithConcurrency } from "@/lib/concurrency";
import { statedRationale } from "@/lib/holding-watch";
import {
  MIN_PATTERN_HOLDINGS,
  PATTERN_READ_SYSTEM_PROMPT,
  buildPatternReadUserContext,
  normalizePatternRead,
  parsePatternRead,
  type PatternHolding,
} from "@/lib/jarvis-scratchpad";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getSectorProfile } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

/**
 * "Read my pattern" — one model call on the whole book.
 *
 * One call, not the Council's N, so 60 seconds is the right ceiling.
 */
export const maxDuration = 60;

/** Enough for the read to react to what the trader is chewing on, bounded so a
 *  long-lived scratchpad cannot grow the prompt without limit. */
const NOTES_IN_CONTEXT = 20;

const HISTORY_PAGE = 20;

export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Before any work: an account that is over budget must cost zero, not one
  // more read's worth.
  const budget = await checkBudget();
  if (!budget.ok) {
    return NextResponse.json(
      { error: budget.message },
      { status: budget.window === "unavailable" ? 503 : 429 },
    );
  }

  const supabase = await createClient();

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id, stock_id")
    .in("status", ["active", "partial_exit"]);
  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }

  // Two positions in the same name are one holding as far as a pattern goes,
  // so the floor is counted in distinct names rather than rows. Checked before
  // any further reads: refusing early costs nothing.
  const distinctTickers = new Set((positions ?? []).map((p) => p.ticker.toUpperCase()));
  if (distinctTickers.size < MIN_PATTERN_HOLDINGS) {
    return NextResponse.json(
      {
        error:
          `A pattern needs at least ${MIN_PATTERN_HOLDINGS} different holdings to be a pattern rather than a coincidence. ` +
          `You have ${distinctTickers.size}. Add more positions, or import the ones you already own.`,
      },
      { status: 400 },
    );
  }

  const all = positions ?? [];
  const [stocksRes, thesesRes, notesRes, profileRes] = await Promise.all([
    supabase
      .from("stocks")
      .select("id, ticker, yahoo_symbol")
      .in("id", all.map((p) => p.stock_id)),
    supabase
      .from("theses")
      .select("id, input_text, source, market_view, mispricing, catalyst, conviction_tier")
      .in("id", all.map((p) => p.thesis_id)),
    supabase
      .from("scratchpad_notes")
      .select("body")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(NOTES_IN_CONTEXT),
    supabase.from("portfolio_profiles").select("objective").eq("user_id", user.id).maybeSingle(),
  ]);

  for (const [what, res] of [
    ["holdings", stocksRes],
    ["theses", thesesRes],
    ["notes", notesRes],
    ["portfolio objective", profileRes],
  ] as const) {
    if (res.error) {
      return NextResponse.json(
        { error: `Could not read your ${what}: ${res.error.message}` },
        { status: 500 },
      );
    }
  }

  const stockById = new Map((stocksRes.data ?? []).map((s) => [s.id, s]));
  const thesisById = new Map((thesesRes.data ?? []).map((t) => [t.id, t]));

  // Collapse same-name positions AFTER the theses are in hand. Which row
  // survives is not arbitrary: only one rationale reaches the model, so a
  // position that has one beats a position that does not. Keeping "whichever
  // arrived first" silently threw away the only stated reason on a holding
  // whenever the same name was entered twice.
  const byTicker = new Map<string, (typeof all)[number]>();
  const explains = (p: (typeof all)[number]) =>
    statedRationale(thesisById.get(p.thesis_id)?.input_text ?? null, p.ticker) !== null;
  for (const p of all) {
    const key = p.ticker.toUpperCase();
    const held = byTicker.get(key);
    if (!held || (explains(p) && !explains(held))) byTicker.set(key, p);
  }
  const distinct = [...byTicker.values()];

  // One symbol's classification failing must cost that holding its sector, not
  // cost the trader the whole read. An unclassified holding is already a case
  // this feature handles honestly.
  const profiles = await mapWithConcurrency(distinct, MAX_CONCURRENT_QUOTES, async (p) => {
    const symbol = stockById.get(p.stock_id)?.yahoo_symbol;
    if (!symbol) return { sector: null, industry: null };
    return getSectorProfile(symbol).catch(() => ({ sector: null, industry: null }));
  });

  const holdings: PatternHolding[] = distinct.map((p, i) => {
    const thesis = thesisById.get(p.thesis_id);
    return {
      ticker: p.ticker,
      companyName: null,
      source: thesis?.source ?? "imported",
      sector: profiles[i].sector,
      industry: profiles[i].industry,
      rationale: statedRationale(thesis?.input_text ?? null, p.ticker),
      marketView: thesis?.market_view ?? null,
      mispricing: thesis?.mispricing ?? null,
      catalyst: thesis?.catalyst ?? null,
      convictionTier: thesis?.conviction_tier ?? null,
    };
  });

  let raw: string;
  try {
    const result = await meteredGenerateText({
      userId: user.id,
      feature: "portfolio_pattern_read",
      // No `thesisId`: this call is about the whole book, not one holding —
      // same as the portfolio Council.
      system: PATTERN_READ_SYSTEM_PROMPT,
      prompt: buildPatternReadUserContext({
        holdings,
        objective: profileRes.data?.objective ?? null,
        notes: (notesRes.data ?? []).map((n) => n.body),
        today: new Date().toISOString().slice(0, 10),
      }),
    });
    raw = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The read failed. Nothing was saved." },
      { status: 502 },
    );
  }

  const parsed = parsePatternRead(raw);
  if (!parsed.ok) {
    // Nothing saved: a read that cannot be validated is not a read, and a row
    // that fails its own schema on the way back in would render as "written in
    // an older format" forever.
    return NextResponse.json({ error: parsed.error }, { status: 502 });
  }

  // Only CLASSIFIED holdings may be named in a signal. The prompt tells the
  // model to leave an unclassified one out; this is what makes that true when
  // it does not. Without it, a model placing LIQUIDCASE in a cluster would have
  // it counted as explained, and the deterministic handling this feature
  // promises would rest entirely on the model obeying an instruction.
  //
  // `unplacedTickers` is computed against EVERY holding, not this set, so the
  // unclassified one still shows up as unplaced rather than disappearing.
  const read = normalizePatternRead(
    parsed.data,
    holdings.filter((h) => h.sector !== null).map((h) => h.ticker),
  );

  const { data: saved, error: saveError } = await supabase
    .from("portfolio_pattern_reads")
    .insert({
      document: read as unknown as Json,
      holdings_snapshot: {
        as_of: new Date().toISOString(),
        holdings: holdings.map((h) => ({
          ticker: h.ticker,
          source: h.source,
          sector: h.sector,
          industry: h.industry,
        })),
      } as unknown as Json,
      raw_llm_response: raw,
    })
    .select("*")
    .single();
  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({ read: saved }, { status: 201 });
}

/** History, newest first, cursor-paged. RLS scopes it. */
export async function GET(request: Request) {
  const before = new URL(request.url).searchParams.get("before");
  const supabase = await createClient();

  let query = supabase
    .from("portfolio_pattern_reads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(HISTORY_PAGE);
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const reads = data ?? [];
  return NextResponse.json({
    reads,
    nextBefore: reads.length === HISTORY_PAGE ? reads[reads.length - 1].created_at : null,
  });
}
