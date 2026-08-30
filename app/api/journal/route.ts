import { NextResponse } from "next/server";
import { z } from "zod";

import { JARVIS_JOURNAL_SYSTEM_PROMPT, buildJournalUserContext } from "@/lib/jarvis-journal-prompt";
import { parseJournalVerdict } from "@/lib/jarvis-journal-parser";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { currentUser } from "@/lib/auth/user";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { createClient } from "@/lib/supabase/server";
import { listJournalEntries } from "@/lib/queries";
import type { TradeJournalEntryInsert } from "@/lib/types";

export const maxDuration = 60;

const CreateJournalSchema = z.object({
  position_id: z.string().min(1),
  generate_only: z.boolean().optional(),
  thesis_outcome: z.enum(["confirmed", "partially_confirmed", "invalidated"]).optional(),
  entry_quality: z.number().int().min(1).max(5).optional(),
  sizing_quality: z.number().int().min(1).max(5).optional(),
  stop_management: z.number().int().min(1).max(5).optional(),
  exit_quality: z.number().int().min(1).max(5).optional(),
  discipline_score: z.number().int().min(1).max(5).optional(),
  what_went_right: z.string().optional(),
  what_went_wrong: z.string().optional(),
  lessons: z.string().optional(),
  jarvis_verdict: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateJournalSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  if (!input.generate_only) {
    const required = ["thesis_outcome", "entry_quality", "sizing_quality", "stop_management", "exit_quality", "discipline_score"] as const;
    for (const field of required) {
      if (input[field] === undefined) {
        return NextResponse.json({ error: `${field} is required unless generate_only is true` }, { status: 400 });
      }
    }
  }

  const supabase = await createClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("id, ticker, thesis_id")
    .eq("id", input.position_id)
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Position not found" }, { status: 404 });
  }

  const [{ data: entries }, { data: exits }, { data: thesis }] = await Promise.all([
    supabase.from("entries").select("date, quantity, price").eq("position_id", position.id),
    supabase.from("exits").select("date, quantity, price, override").eq("position_id", position.id),
    supabase.from("theses").select("market_view, invalidation_condition, conviction_tier").eq("id", position.thesis_id).single(),
  ]);

  const entryRows = entries ?? [];
  const exitRows = exits ?? [];
  const weightedAverage = computeWeightedAverageEntry(entryRows);
  const totalCost = weightedAverage.averagePrice * weightedAverage.totalQuantity;
  const totalProceeds = exitRows.reduce((sum, e) => sum + e.quantity * e.price, 0);
  const pnlRupees = totalProceeds - totalCost;
  const pnlPct = totalCost > 0 ? (pnlRupees / totalCost) * 100 : 0;
  const entryDates = entryRows.map((e) => e.date);
  const exitDates = exitRows.map((e) => e.date);
  const hasOverride = exitRows.some((e) => e.override);

  let verdict: string | null = input.jarvis_verdict ?? null;
  let suggestedTags: string[] = input.tags ?? [];
  // Unlike the thesis and memorandum routes, being over budget does NOT fail
  // this request. The Jarvis verdict is a garnish on a review the trader has
  // already written; refusing to save their words because an optional model
  // call is unaffordable would be the wrong trade. It degrades to the same
  // "no verdict" path a failed call already takes.
  const user = await currentUser();
  const affordable = user !== null && (await checkBudget()).ok;

  if (verdict === null && affordable && (input.tags === undefined || input.tags.length === 0)) {
    try {
      const result = await meteredGenerateText({
        userId: user!.id,
        feature: "journal",
        system: JARVIS_JOURNAL_SYSTEM_PROMPT,
        prompt: buildJournalUserContext({
          ticker: position.ticker,
          marketView: thesis?.market_view ?? null,
          invalidationCondition: thesis?.invalidation_condition ?? null,
          convictionTier: thesis?.conviction_tier ?? null,
          pnlPct,
          thesisOutcome: input.thesis_outcome ?? "unknown",
          disciplineScore: input.discipline_score ?? 0,
        }),
      });
      const parsedVerdict = parseJournalVerdict(result.text);
      if (parsedVerdict.ok) {
        verdict = parsedVerdict.data.verdict;
        suggestedTags = parsedVerdict.data.suggestedTags;
      }
    } catch {
      // Best-effort — a failed Jarvis call must never block saving the review itself.
    }
  }
  const tags = hasOverride ? [...suggestedTags, "Discipline Break"] : suggestedTags;

  if (input.generate_only) {
    return NextResponse.json({
      verdict,
      suggestedTags: tags,
      autoFilled: { ticker: position.ticker, entryDates, exitDates, pnlRupees, pnlPct, convictionTier: thesis?.conviction_tier ?? null },
    });
  }

  const insert: TradeJournalEntryInsert = {
    position_id: position.id,
    ticker: position.ticker,
    entry_dates: entryDates,
    exit_dates: exitDates,
    pnl_rupees: pnlRupees,
    pnl_pct: pnlPct,
    thesis_outcome: input.thesis_outcome!,
    conviction_tier_used: thesis?.conviction_tier ?? "IV",
    entry_quality: input.entry_quality!,
    sizing_quality: input.sizing_quality!,
    stop_management: input.stop_management!,
    exit_quality: input.exit_quality!,
    discipline_score: input.discipline_score!,
    what_went_right: input.what_went_right ?? null,
    what_went_wrong: input.what_went_wrong ?? null,
    lessons: input.lessons ?? null,
    jarvis_verdict: verdict,
    tags,
  };

  const { data: entry, error: insertError } = await supabase
    .from("trade_journal_entries")
    .insert(insert)
    .select("*")
    .single();
  if (insertError || !entry) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to save journal entry" }, { status: 500 });
  }

  /** Belt-and-suspenders with Task 22's quantity-driven closure — spec US-18 says explicitly that saving the review is what closes the position, so this is idempotent-but-authoritative even if Task 22 already closed it. */
  const { error: closeError } = await supabase.from("positions").update({ status: "closed" }).eq("id", position.id);
  if (closeError) {
    return NextResponse.json({ error: closeError.message }, { status: 500 });
  }

  return NextResponse.json({ entry }, { status: 201 });
}

export async function GET() {
  try {
    return NextResponse.json({ entries: await listJournalEntries() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
