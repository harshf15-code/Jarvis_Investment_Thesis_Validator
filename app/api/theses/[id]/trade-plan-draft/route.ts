import { NextResponse } from "next/server";
import { generateText } from "ai";

import {
  buildTradePlanUserContext,
  JARVIS_TRADE_PLAN_SYSTEM_PROMPT,
} from "@/lib/jarvis-thesis-prompt";
import { parseTradePlanDraft, sanitizeTradePlanDraft } from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { getFundamentals, getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * US-12: "Grid is pre-filled by Claude API based on the thesis."
 *
 * Returns a suggestion only — nothing is written to `trade_plans` here. The
 * grid stays the trader's to edit, and the plan is created by the existing
 * `POST /api/trade-plans` when they lock it, which is also what keeps
 * `ai_suggested` meaning "what Jarvis proposed" for the Reset affordance.
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
  if (!thesis.ticker) {
    return NextResponse.json(
      { error: "This thesis has no instrument yet — pick a candidate before drafting a plan." },
      { status: 400 },
    );
  }

  const { data: stock } = thesis.stock_id
    ? await supabase
        .from("stocks")
        .select("exchange, yahoo_symbol, last_price")
        .eq("id", thesis.stock_id)
        .single()
    : { data: null };

  // Fetch live rather than trusting `stocks.last_price`: every level in the
  // draft is anchored to CMP, so a stale price silently poisons the whole plan.
  let cmp: number | null = stock?.last_price ?? null;
  let fundamentals: Record<string, string | number> = {};
  if (stock?.yahoo_symbol) {
    const [quote, funds] = await Promise.all([
      getQuote(stock.yahoo_symbol).catch(() => null),
      getFundamentals(stock.yahoo_symbol).catch(() => ({})),
    ]);
    if (quote) cmp = quote.price;
    fundamentals = funds;
  }

  let raw: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_TRADE_PLAN_SYSTEM_PROMPT,
      prompt: buildTradePlanUserContext({
        thesis,
        bearCases: thesis.bear_cases ?? [],
        cmp,
        exchange: stock?.exchange ?? null,
        fundamentals,
        todayIso: new Date().toISOString().slice(0, 10),
      }),
    });
    raw = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Trade-plan draft call failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }

  const parsed = parseTradePlanDraft(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `Could not read Jarvis's trade plan: ${parsed.error}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ draft: sanitizeTradePlanDraft(parsed.data), cmp });
}
