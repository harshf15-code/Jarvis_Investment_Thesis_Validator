import { NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import {
  buildCouncilOpinionSystemPrompt,
  buildCouncilOpinionUserContext,
  buildCouncilSynthesisUserContext,
  normalizeCouncilReport,
  parseCouncilOpinion,
  parseCouncilSynthesis,
  COUNCIL_CONSULT_MIN,
  COUNCIL_ROSTER_MAX,
  JARVIS_COUNCIL_SYNTHESIS_SYSTEM_PROMPT,
  type CouncilMemberOpinion,
  type CouncilOpinion,
  type CouncilReport,
} from "@/lib/jarvis-council";
import { MemorandumSchema } from "@/lib/jarvis-memorandum";
import { jarvisModel } from "@/lib/llm/openrouter";
import { MARKETS, isLiveMarket } from "@/lib/markets";
import { createClient } from "@/lib/supabase/server";
import type { MarketCode } from "@/lib/types";

// N member calls run in PARALLEL plus one synthesis call, so wall-clock time is
// roughly two calls however large the panel. The ceiling is generous because a
// seven-member panel has seven chances to be the slow one.
export const maxDuration = 180;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ConsultInputSchema = z.object({
  member_ids: z
    .array(z.string().uuid("Not a member id"))
    .min(COUNCIL_CONSULT_MIN, `Pick at least ${COUNCIL_CONSULT_MIN} members`)
    .max(COUNCIL_ROSTER_MAX, `A council is at most ${COUNCIL_ROSTER_MAX} members`)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate member"),
});

/**
 * Convenes the Investment Council over an ALREADY-GENERATED memorandum.
 *
 * The memorandum is a precondition, not an input this route can produce: every
 * member reads the same stored document and the same persisted candidate grid,
 * so a consult costs N+1 model calls and ZERO market-data lookups however large
 * the panel.
 *
 * The N member calls are independent by design (v1 is not a debate), which is
 * what lets them run concurrently and what lets one of them fail without taking
 * the report with it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const json = await request.json().catch(() => null);
  const parsedInput = ConsultInputSchema.safeParse(json ?? {});
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsedInput.error.flatten() },
      { status: 400 },
    );
  }
  const { member_ids } = parsedInput.data;

  const { data: thesis, error: thesisError } = await supabase
    .from("theses")
    .select("*")
    .eq("id", id)
    .single();
  if (thesisError || !thesis) {
    return NextResponse.json({ error: thesisError?.message ?? "Thesis not found" }, { status: 404 });
  }

  // Same market guards as the memorandum route — a council is convened over one
  // market's report, because that is the unit a memorandum exists in.
  const requested = new URL(request.url).searchParams.get("market");
  const market = (requested ?? thesis.markets?.[0] ?? "US") as MarketCode;
  if (!isLiveMarket(market)) {
    return NextResponse.json({ error: `Market "${market}" is not available yet.` }, { status: 400 });
  }
  if (!thesis.markets?.includes(market)) {
    return NextResponse.json(
      { error: `This thesis was not created for ${MARKETS[market].label}.` },
      { status: 400 },
    );
  }

  // --- 1. The memorandum being reviewed ----------------------------------
  const { data: memoRow } = await supabase
    .from("thesis_memorandums")
    .select("*")
    .eq("thesis_id", id)
    .eq("market", market)
    .maybeSingle();

  // 409, not 404: the thesis exists, the precondition does not.
  if (!memoRow) {
    return NextResponse.json(
      {
        error: `Run the ${MARKETS[market].label} analysis first — the Council reviews a memorandum, it doesn't write one.`,
      },
      { status: 409 },
    );
  }

  const memoParsed = MemorandumSchema.safeParse(memoRow.document);
  if (!memoParsed.success) {
    return NextResponse.json(
      { error: "This memorandum was written in an older format. Re-run it before consulting." },
      { status: 409 },
    );
  }
  const memo = memoParsed.data;

  const { data: candidates, error: candidateError } = await supabase
    .from("thesis_candidates")
    .select("*")
    .eq("thesis_id", id)
    .eq("market", market)
    .order("rank", { ascending: true });
  if (candidateError) {
    return NextResponse.json({ error: candidateError.message }, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json(
      { error: "This memorandum has no priced candidates to review. Re-run the analysis." },
      { status: 409 },
    );
  }

  // --- 2. The panel -------------------------------------------------------
  // RLS scopes this to the caller's own roster, so an id belonging to someone
  // else simply does not come back — which surfaces below as a count mismatch
  // rather than as a silent consult with fewer members than were chosen.
  const { data: members, error: memberError } = await supabase
    .from("council_members")
    .select("*")
    .in("id", member_ids)
    .order("sort_order", { ascending: true });
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }
  if (!members || members.length !== member_ids.length) {
    return NextResponse.json(
      { error: "One or more of the chosen council members no longer exists." },
      { status: 400 },
    );
  }

  // --- 3. N independent opinions, in parallel -----------------------------
  const sharedContext = buildCouncilOpinionUserContext({
    thesisText: thesis.input_text,
    market,
    memo,
    candidates,
  });

  const settled = await Promise.allSettled(
    members.map(async (m): Promise<CouncilOpinion> => {
      const result = await generateText({
        model: jarvisModel,
        system: buildCouncilOpinionSystemPrompt(m),
        prompt: sharedContext,
      });
      const parsed = parseCouncilOpinion(result.text);
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.data;
    }),
  );

  // A failed member gets a card carrying the reason, never a blank one. With a
  // seven-member panel the odds of at least one failure are meaningfully higher
  // than with three, so this path is the normal case, not the exotic one.
  const opinions: CouncilMemberOpinion[] = members.map((m, i) => {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      return {
        member_id: m.id,
        member_name: m.name,
        source: m.source,
        opinion: outcome.value,
        error: null,
      };
    }
    return {
      member_id: m.id,
      member_name: m.name,
      source: m.source,
      opinion: null,
      error: errorMessage(outcome.reason),
    };
  });

  const answered = opinions.filter(
    (o): o is CouncilMemberOpinion & { opinion: CouncilOpinion } => o.opinion !== null,
  );
  if (answered.length === 0) {
    return NextResponse.json(
      { error: `No council member returned a usable opinion. First error: ${opinions[0].error}` },
      { status: 502 },
    );
  }

  // --- 4. One synthesis pass ---------------------------------------------
  // Skipped at a single opinion: there is nothing to reconcile, and spending a
  // model call to restate one card would be spend without information.
  let synthesis: CouncilReport["synthesis"] = null;
  let synthesisRaw = "";
  if (answered.length >= 2) {
    try {
      const result = await generateText({
        model: jarvisModel,
        system: JARVIS_COUNCIL_SYNTHESIS_SYSTEM_PROMPT,
        prompt: buildCouncilSynthesisUserContext({
          jarvisPick: memo.primary_ticker,
          opinions: answered.map((o) => ({ name: o.member_name, opinion: o.opinion })),
        }),
      });
      synthesisRaw = result.text;
      const parsed = parseCouncilSynthesis(result.text);
      // A failed synthesis costs the summary block, not the whole report — the
      // member cards are the substance and they are already in hand.
      if (parsed.ok) synthesis = parsed.data;
    } catch {
      synthesis = null;
    }
  }

  const report = normalizeCouncilReport(
    {
      jarvis_pick: memo.primary_ticker,
      opinions,
      synthesis,
      generated_at: new Date().toISOString(),
    },
    candidates.map((c) => c.ticker),
  );

  // --- 5. Persist ---------------------------------------------------------
  const { data: saved, error: saveError } = await supabase
    .from("thesis_council_reports")
    .upsert(
      {
        thesis_id: id,
        market,
        memorandum_id: memoRow.id,
        document: report,
        raw_llm_response: synthesisRaw || null,
      },
      { onConflict: "thesis_id,market" },
    )
    .select("*")
    .single();
  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({ market, report: saved, memorandumId: memoRow.id });
}

/** Reads a stored council report without spending model calls. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const requested = new URL(request.url).searchParams.get("market");
  const { data: thesis } = await supabase.from("theses").select("markets").eq("id", id).single();
  const market = (requested ?? thesis?.markets?.[0] ?? "US") as MarketCode;

  const { data: report, error } = await supabase
    .from("thesis_council_reports")
    .select("*")
    .eq("thesis_id", id)
    .eq("market", market)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ market, report: report ?? null });
}
