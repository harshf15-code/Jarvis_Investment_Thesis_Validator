import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";

import { buildJarvisAnalysisInsert, buildAlertCriteriaInsert, computeNextVersion } from "@/lib/jarvis-run";
import { buildJarvisUserContext, JARVIS_SYSTEM_PROMPT } from "@/lib/jarvis-prompt";
import { parseJarvisResponse } from "@/lib/jarvis-parser";
import { JARVIS_MODEL_ID, jarvisModel } from "@/lib/llm/openrouter";
import { getFundamentals, getHistoricalOHLCV, getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types";
import { RunJarvisInputSchema } from "@/lib/validation/schemas";

/**
 * POST /api/jarvis/run — runs a fresh Jarvis analysis for one stock and
 * persists it as a new versioned `jarvis_analyses` row (plus a new
 * `alert_criteria` row when structured extraction succeeds). This is a
 * background analysis write (10-30s expected), not a chat UI, so the model
 * is called non-streaming via `generateText`.
 *
 * Number of calendar days of OHLCV history requested from Yahoo. The brief
 * asks for "30+ days"; 60 calendar days comfortably covers 30+ *trading*
 * days once weekends/holidays are excluded, while `buildJarvisUserContext`
 * itself only ever includes the most recent 30 bars in the prompt text.
 */
const HISTORY_DAYS = 60;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedInput = RunJarvisInputSchema.safeParse(json);
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsedInput.error.flatten() },
      { status: 400 },
    );
  }
  const { stockId } = parsedInput.data;

  const supabase = createAdminClient();

  // Step 1: load the stock.
  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("*")
    .eq("id", stockId)
    .is("deleted_at", null)
    .maybeSingle();

  if (stockError) {
    return NextResponse.json({ error: stockError.message }, { status: 500 });
  }
  if (!stock) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  // Step 2: live market context (Yahoo). Network/transport failures here
  // are treated the same as an LLM network failure — a clean 502, not an
  // unhandled rejection.
  let quote: Awaited<ReturnType<typeof getQuote>>;
  let ohlcv: Awaited<ReturnType<typeof getHistoricalOHLCV>>;
  let fundamentals: Awaited<ReturnType<typeof getFundamentals>>;
  try {
    [quote, ohlcv, fundamentals] = await Promise.all([
      getQuote(stock.yahoo_symbol),
      getHistoricalOHLCV(stock.yahoo_symbol, { days: HISTORY_DAYS }),
      getFundamentals(stock.yahoo_symbol),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch market data: ${errorMessage(err)}` },
      { status: 502 },
    );
  }

  const { data: manualFundamentalsRows, error: manualFundamentalsError } =
    await supabase
      .from("fundamentals")
      .select("metric_key, metric_value")
      .eq("stock_id", stockId)
      .eq("source", "manual");

  if (manualFundamentalsError) {
    return NextResponse.json(
      { error: manualFundamentalsError.message },
      { status: 500 },
    );
  }

  const customFundamentals: Record<string, string> = {};
  for (const row of manualFundamentalsRows ?? []) {
    customFundamentals[row.metric_key] = row.metric_value;
  }

  // Step 3: build the prompt.
  const userContext = buildJarvisUserContext({
    yahooSymbol: stock.yahoo_symbol,
    exchange: stock.exchange,
    price: quote.price,
    priceAsOf: quote.asOf,
    ohlcv,
    fundamentals,
    customFundamentals,
  });

  // Step 3 (cont'd): call the model, non-streaming.
  let rawResponse: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_SYSTEM_PROMPT,
      prompt: userContext,
    });
    rawResponse = result.text;
  } catch (err) {
    return NextResponse.json(
      { error: `Jarvis model call failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }

  if (!rawResponse) {
    return NextResponse.json(
      { error: "Jarvis returned an empty response" },
      { status: 502 },
    );
  }

  // Step 4: parse (never throws).
  const parsed = parseJarvisResponse(rawResponse);

  // Step 5: next version number.
  const { data: existingVersionRows, error: versionsError } = await supabase
    .from("jarvis_analyses")
    .select("version")
    .eq("stock_id", stockId);

  if (versionsError) {
    return NextResponse.json({ error: versionsError.message }, { status: 500 });
  }

  const nextVersion = computeNextVersion(
    (existingVersionRows ?? []).map((row) => row.version),
  );

  const inputContextSnapshot: Json = {
    price: quote.price,
    priceAsOf: quote.asOf.toISOString(),
    ohlcv: ohlcv as unknown as Json,
    fundamentals: fundamentals as unknown as Json,
    customFundamentals,
  };

  // Step 6: set any existing is_latest row to false BEFORE inserting the
  // new one, then insert.
  const { error: unsetLatestError } = await supabase
    .from("jarvis_analyses")
    .update({ is_latest: false })
    .eq("stock_id", stockId)
    .eq("is_latest", true);

  if (unsetLatestError) {
    return NextResponse.json({ error: unsetLatestError.message }, { status: 500 });
  }

  const analysisInsert = buildJarvisAnalysisInsert({
    stockId,
    version: nextVersion,
    extractionOk: parsed.extraction.ok,
    sections: parsed.sections,
    rawResponse,
    modelId: JARVIS_MODEL_ID,
    inputContext: inputContextSnapshot,
  });

  const { data: insertedAnalysis, error: insertAnalysisError } = await supabase
    .from("jarvis_analyses")
    .insert(analysisInsert)
    .select("*")
    .single();

  if (insertAnalysisError || !insertedAnalysis) {
    return NextResponse.json(
      { error: insertAnalysisError?.message ?? "Failed to insert jarvis_analyses row" },
      { status: 500 },
    );
  }

  // Step 7: alert_criteria bookkeeping — ONLY on successful extraction.
  // Skipping this entirely on failure is deliberate: it leaves any
  // previous is_active row untouched, so monitoring doesn't silently go
  // dark just because one re-run's extraction failed.
  if (parsed.extraction.ok) {
    const { error: unsetActiveError } = await supabase
      .from("alert_criteria")
      .update({ is_active: false })
      .eq("stock_id", stockId)
      .eq("is_active", true);

    if (unsetActiveError) {
      return NextResponse.json({ error: unsetActiveError.message }, { status: 500 });
    }

    const alertCriteriaInsert = buildAlertCriteriaInsert({
      stockId,
      jarvisAnalysisId: insertedAnalysis.id,
      data: parsed.extraction.data,
    });

    const { error: insertAlertCriteriaError } = await supabase
      .from("alert_criteria")
      .insert(alertCriteriaInsert);

    if (insertAlertCriteriaError) {
      return NextResponse.json(
        { error: insertAlertCriteriaError.message },
        { status: 500 },
      );
    }
  }

  // Step 8: return the full new jarvis_analyses row.
  return NextResponse.json(insertedAnalysis, { status: 201 });
}
