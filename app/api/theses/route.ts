import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import { extractPossibleTicker } from "@/lib/ticker-heuristic";
import {
  buildJarvisThesisUserContext,
  JARVIS_THESIS_SYSTEM_PROMPT,
} from "@/lib/jarvis-thesis-prompt";
import { parseThesisResponse } from "@/lib/jarvis-thesis-parser";
import { jarvisModel } from "@/lib/llm/openrouter";
import { getFundamentals, getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExchangeCode, Json, ThesisInsert } from "@/lib/types";

export const maxDuration = 60;

const CreateThesisInputSchema = z.object({
  input_text: z.string().trim().min(1, "input_text is required"),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tries NSE then US for a heuristically-extracted ticker token (see
 * `lib/ticker-heuristic.ts`'s module comment — this app has no real
 * exchange-detection signal, so it just tries both in a fixed order and
 * keeps whichever resolves first). Returns `null` if neither resolves,
 * which is the expected, non-error outcome for genuine Mode 2 input.
 */
async function tryResolveTicker(
  ticker: string,
): Promise<{ exchange: ExchangeCode; yahooSymbol: string; price: number; priceAsOf: Date; fundamentals: Record<string, string | number> } | null> {
  for (const exchange of ["NSE", "US"] as const) {
    const yahooSymbol = resolveYahooSymbol(ticker, exchange);
    try {
      const [quote, fundamentals] = await Promise.all([
        getQuote(yahooSymbol),
        getFundamentals(yahooSymbol).catch(() => ({})),
      ]);
      return { exchange, yahooSymbol, price: quote.price, priceAsOf: quote.asOf, fundamentals };
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedInput = CreateThesisInputSchema.safeParse(json);
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsedInput.error.flatten() },
      { status: 400 },
    );
  }
  const { input_text } = parsedInput.data;

  const supabase = createAdminClient();

  // Heuristic resolution — a context-fetching optimization, not the final
  // mode/ticker answer (see Task 7's design note).
  const heuristicTicker = extractPossibleTicker(input_text);
  const resolved = heuristicTicker ? await tryResolveTicker(heuristicTicker) : null;

  let stockId: string | null = null;
  if (resolved) {
    const { data: existingStock, error: stockLookupError } = await supabase
      .from("stocks")
      .select("id")
      .eq("yahoo_symbol", resolved.yahooSymbol)
      .maybeSingle();

    if (stockLookupError) {
      return NextResponse.json({ error: stockLookupError.message }, { status: 500 });
    }

    if (existingStock) {
      stockId = existingStock.id;
    } else {
      const { data: newStock, error: stockInsertError } = await supabase
        .from("stocks")
        .insert({
          ticker: heuristicTicker!,
          yahoo_symbol: resolved.yahooSymbol,
          exchange: resolved.exchange,
          last_price: resolved.price,
          last_price_at: resolved.priceAsOf.toISOString(),
        })
        .select("id")
        .single();
      if (stockInsertError || !newStock) {
        return NextResponse.json(
          { error: stockInsertError?.message ?? "Failed to create stock row" },
          { status: 500 },
        );
      }
      stockId = newStock.id;
    }
  }

  const userContext = buildJarvisThesisUserContext({
    inputText: input_text,
    marketContext: resolved
      ? {
          yahooSymbol: resolved.yahooSymbol,
          exchange: resolved.exchange,
          price: resolved.price,
          priceAsOf: resolved.priceAsOf,
          fundamentals: resolved.fundamentals,
        }
      : undefined,
  });

  let rawResponse: string;
  try {
    const result = await generateText({
      model: jarvisModel,
      system: JARVIS_THESIS_SYSTEM_PROMPT,
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
    return NextResponse.json({ error: "Jarvis returned an empty response" }, { status: 502 });
  }

  const parsed = parseThesisResponse(rawResponse);
  const extractedTicker = parsed.extraction.ok ? parsed.extraction.data.ticker : heuristicTicker;

  // US-10 duplicate-thesis warning — informational only, never blocks.
  let duplicateWarning: { existingThesisId: string; status: string; createdAt: string } | null = null;
  if (extractedTicker) {
    // Error intentionally swallowed here: this lookup is purely informational
    // (US-10), so a transient read failure should not block thesis creation —
    // it just means the warning is silently skipped for this request. Do not
    // "fix" this into an early return.
    const { data: existingTheses } = await supabase
      .from("theses")
      .select("id, status, created_at")
      .eq("ticker", extractedTicker)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = existingTheses?.[0];
    if (existing) {
      duplicateWarning = {
        existingThesisId: existing.id,
        status: existing.status,
        createdAt: existing.created_at,
      };
    }
  }

  const insert: ThesisInsert = {
    input_text,
    mode: parsed.extraction.ok ? parsed.extraction.data.mode : "thesis_only",
    stock_id: stockId,
    ticker: extractedTicker,
    market_view: parsed.extraction.ok ? parsed.extraction.data.market_view : parsed.sections.marketView || null,
    mispricing: parsed.extraction.ok ? parsed.extraction.data.mispricing : parsed.sections.mispricing || null,
    catalyst: parsed.extraction.ok ? parsed.extraction.data.catalyst : parsed.sections.catalyst || null,
    time_horizon: parsed.extraction.ok ? parsed.extraction.data.time_horizon : parsed.sections.timeHorizon || null,
    invalidation_condition: parsed.extraction.ok
      ? parsed.extraction.data.invalidation_condition
      : parsed.sections.invalidation || null,
    conviction_tier: parsed.extraction.ok ? parsed.extraction.data.conviction_tier : null,
    conviction_score: parsed.extraction.ok ? parsed.extraction.data.conviction_score : null,
    status: "draft",
    raw_llm_response: rawResponse,
  };

  const { data: insertedThesis, error: insertError } = await supabase
    .from("theses")
    .insert(insert)
    .select("*")
    .single();

  if (insertError || !insertedThesis) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to insert thesis row" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      thesis: insertedThesis,
      stockSuggestions: parsed.extraction.ok ? parsed.extraction.data.stock_suggestions : [],
      duplicateWarning,
    },
    { status: 201 },
  );
}
