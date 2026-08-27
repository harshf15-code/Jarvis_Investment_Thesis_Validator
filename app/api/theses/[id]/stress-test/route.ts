import { NextResponse } from "next/server";
import { generateText } from "ai";

import {
  JARVIS_STRESS_TEST_SYSTEM_PROMPT,
  buildStressTestUserContext,
} from "@/lib/jarvis-thesis-prompt";
import { parseStressTestResponse } from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Spec Screen 2-3 Step 2 (US-11). Re-runnable — each call overwrites `theses.bear_cases`. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: thesis, error: fetchError } = await supabase
    .from("theses")
    .select("market_view, mispricing, catalyst, invalidation_condition")
    .eq("id", id)
    .single();
  if (fetchError || !thesis) {
    return NextResponse.json({ error: fetchError?.message ?? "Thesis not found" }, { status: 404 });
  }

  let rawResponse: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_STRESS_TEST_SYSTEM_PROMPT,
      prompt: buildStressTestUserContext(thesis),
    });
    rawResponse = result.text;
  } catch (err) {
    return NextResponse.json({ error: `Jarvis model call failed: ${errorMessage(err)}` }, { status: 502 });
  }

  const parsed = parseStressTestResponse(rawResponse);
  if (!parsed.ok) {
    return NextResponse.json({ error: `Stress test extraction failed: ${parsed.error}` }, { status: 502 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("theses")
    .update({ bear_cases: parsed.data.bear_cases, raw_llm_response: rawResponse })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to save bear cases" }, { status: 500 });
  }

  return NextResponse.json({ thesis: updated });
}
