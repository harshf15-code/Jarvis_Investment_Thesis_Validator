import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { extractPossibleTicker } from "@/lib/ticker-heuristic";
import {
  buildJarvisThesisUserContext,
  JARVIS_THESIS_SYSTEM_PROMPT,
} from "@/lib/jarvis-thesis-prompt";
import { parseThesisResponse } from "@/lib/jarvis-thesis-parser";
import { checkBudget } from "@/lib/llm/budget";
import { meteredGenerateText } from "@/lib/llm/meter";
import { getFundamentals, getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { currencyForExchange, isLiveMarket, exchangesFor } from "@/lib/markets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { listTheses } from "@/lib/queries";
import type { ExchangeCode, MarketCode, ThesisInsert } from "@/lib/types";

export const maxDuration = 60;

const CreateThesisInputSchema = z.object({
  input_text: z.string().trim().min(1, "input_text is required"),
  /**
   * Markets to run this thesis against. Must be live (see `lib/markets.ts`) —
   * CN/EU/EM are visible in the picker but rejected here, because pricing them
   * needs currency support the app does not have and a half-priced report is
   * worse than none.
   */
  markets: z
    .array(z.string())
    .min(1, "Pick at least one market")
    .refine((m) => m.every(isLiveMarket), "Unsupported market"),
  /**
   * The trader's own declaration that they named a stock. When false the
   * ticker is forced to null regardless of what the model returns — see the
   * `ticker` handling below.
   */
  names_stocks: z.boolean().default(false),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tries each exchange of the trader's chosen markets, in order, for a
 * heuristically-extracted ticker token (see `lib/ticker-heuristic.ts`'s module
 * comment — this app has no real exchange-detection signal). Returns `null` if
 * none resolve, which is the expected, non-error outcome for genuine Mode 2
 * input.
 *
 * The probe list comes from the selected markets rather than a hardcoded
 * ["NSE","US"], so a ticker that only exists outside the chosen universe
 * correctly fails to resolve instead of being priced from a market the trader
 * did not ask about.
 */
async function tryResolveTicker(
  ticker: string,
  exchanges: readonly ExchangeCode[],
): Promise<{ exchange: ExchangeCode; yahooSymbol: string; price: number; priceAsOf: Date; currency: string; fundamentals: Record<string, string | number> } | null> {
  for (const exchange of exchanges) {
    const yahooSymbol = resolveYahooSymbol(ticker, exchange);
    try {
      const [quote, fundamentals] = await Promise.all([
        getQuote(yahooSymbol),
        getFundamentals(yahooSymbol).catch(() => ({})),
      ]);
      return {
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
  const { input_text, names_stocks } = parsedInput.data;
  const markets = parsedInput.data.markets as MarketCode[];

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

  const supabase = await createClient();

  // Every exchange across the chosen markets, deduped — the universe this
  // thesis is allowed to resolve names from.
  const exchanges = [...new Set(markets.flatMap((m) => exchangesFor(m)))];

  // Heuristic resolution — a context-fetching optimization, not the final
  // mode/ticker answer (see Task 7's design note). Skipped entirely when the
  // trader says they named no stock: there is nothing to look for, and it
  // saves up to `exchanges.length` live Yahoo round trips.
  const heuristicTicker = names_stocks ? extractPossibleTicker(input_text) : null;
  const resolved = heuristicTicker ? await tryResolveTicker(heuristicTicker, exchanges) : null;

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
      // `stocks` is a shared market-data cache that `authenticated` may read
      // but not write (0014) — otherwise one account could rewrite the price
      // every account sees. Maintaining it is a service-role job.
      const { data: newStock, error: stockInsertError } = await createAdminClient()
        .from("stocks")
        .insert({
          ticker: heuristicTicker!,
          yahoo_symbol: resolved.yahooSymbol,
          exchange: resolved.exchange,
          currency: resolved.currency,
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
    const result = await meteredGenerateText({
      userId: user.id,
      feature: "thesis",
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

  /**
   * The ticker the trader actually named — never one the model volunteered.
   *
   * `theses.ticker` is not a label. The memorandum route branches on it to
   * choose between "this stock vs its peers" and "build a basket from the
   * thesis", and the peer path seeds it first and never drops it. That is the
   * authority of the trader's own conviction, so only the trader may grant it:
   *
   *   - `names_stocks` false -> null, whatever the model said.
   *   - `thesis_only` -> already null (`normalizeExtract` in the parser).
   *   - otherwise -> the model's ticker, but only once it has actually
   *     resolved on an exchange in the chosen markets. An unresolvable name
   *     cannot be priced, so seeding it would poison the comparison for a
   *     stock nobody can buy.
   *
   * A robotics thesis previously came back anchored to ZBRA on exactly this
   * path, with the name appearing nowhere in the trader's text.
   */
  const modelTicker = parsed.extraction.ok ? parsed.extraction.data.ticker : heuristicTicker;
  let extractedTicker: string | null = null;
  if (names_stocks && modelTicker) {
    // The heuristic only sees UPPERCASE tokens, so "Bajaj Auto" resolves
    // nothing while the model correctly reads it as BAJAJ-AUTO. Reuse the
    // earlier lookup when it was for this same ticker, otherwise spend one
    // more probe rather than discarding a stock the trader really did name.
    const hit =
      resolved && heuristicTicker === modelTicker
        ? resolved
        : await tryResolveTicker(modelTicker, exchanges);
    extractedTicker = hit ? modelTicker : null;
  }

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
    markets,
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

/** Screen HUB-3's thesis list (Task 21) — newest first. */
export async function GET() {
  try {
    return NextResponse.json({ theses: await listTheses() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
