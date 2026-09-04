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
import { formatCurrency } from "@/lib/format";
import {
  type ThesisCreated,
  type ThesisProgressEvent,
  type ThesisStep,
} from "@/lib/thesis-progress";
import type { ExchangeCode, MarketCode, ThesisInsert } from "@/lib/types";

/**
 * 180, not 60.
 *
 * This route is a model call with a variable Yahoo tail on BOTH sides of it:
 * `tryResolveTicker` probes every exchange of the chosen markets before the
 * generation, and runs again afterwards whenever the model names a ticker the
 * heuristic did not (see the `extractedTicker` block below). On lowercase input
 * the heuristic finds nothing at all, so the entire probe sits behind the most
 * expensive step in the request.
 *
 * At 60 this was the lowest ceiling of any route in the app that calls the
 * model — the memorandum and thesis council both sit at 180 for less work — and
 * a first-thesis run on a cold function hit it in production on 2026-09-01: a
 * 504 with nothing written, since the insert is the last thing that happens. A
 * timeout here is worse than a slow response, because the function is killed
 * outright and `meteredGenerateText`'s ledger write dies with it: OpenRouter
 * bills for the generation and `llm_usage` never learns about it.
 */
export const maxDuration = 180;

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
      // A US probe is a BARE ticker, so Yahoo may answer with a foreign
      // listing — `NESN` is Swiss francs, `BP.L` is pence. Accepting it would
      // seed a US thesis, and later a memorandum candidate, from a market the
      // trader never asked about, priced in money the grid does not label.
      // Same rule the CSV import applies; a market means one currency.
      if (quote.currency != null && quote.currency !== currencyForExchange(exchange)) {
        continue;
      }
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

/**
 * A failure that happens after the response has already begun.
 *
 * Once the first byte is on the wire the status line is spent, so these can no
 * longer be a 502 or a 500 — they arrive as the run's terminal event instead.
 * The message is the same one the non-streaming version returned, because the
 * message is what the trader actually reads.
 */
class ThesisRunError extends Error {}

/**
 * Runs the thesis, reporting each step as it finishes.
 *
 * Split out from `POST` so that the guards which CAN still set a status code
 * stay where they can, and everything that has to be reported mid-flight lives
 * behind one `emit`. Nothing in here is emitted speculatively: a step is marked
 * done after the work it names has returned.
 */
async function runThesis(
  input: {
    inputText: string;
    namesStocks: boolean;
    markets: MarketCode[];
    userId: string;
  },
  emit: (event: ThesisProgressEvent) => void,
): Promise<ThesisCreated> {
  const { inputText, namesStocks, markets, userId } = input;
  const step = (id: ThesisStep, status: "active" | "done", detail?: string) =>
    emit({ kind: "step", step: id, status, detail: detail ?? null });

  // The budget check has already passed — `POST` will not open a stream
  // otherwise — so this reports a fact rather than starting one.
  step("budget", "done");

  const supabase = await createClient();

  // Every exchange across the chosen markets, deduped — the universe this
  // thesis is allowed to resolve names from.
  const exchanges = [...new Set(markets.flatMap((m) => exchangesFor(m)))];

  // Heuristic resolution — a context-fetching optimization, not the final
  // mode/ticker answer (see Task 7's design note). Skipped entirely when the
  // trader says they named no stock: there is nothing to look for, and it
  // saves up to `exchanges.length` live Yahoo round trips.
  step("resolve", "active");
  const heuristicTicker = namesStocks ? extractPossibleTicker(inputText) : null;
  const resolved = heuristicTicker ? await tryResolveTicker(heuristicTicker, exchanges) : null;

  let stockId: string | null = null;
  if (resolved) {
    const { data: existingStock, error: stockLookupError } = await supabase
      .from("stocks")
      .select("id")
      .eq("yahoo_symbol", resolved.yahooSymbol)
      .maybeSingle();

    if (stockLookupError) {
      throw new ThesisRunError(stockLookupError.message);
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
        throw new ThesisRunError(stockInsertError?.message ?? "Failed to create stock row");
      }
      stockId = newStock.id;
    }
  }

  // The price is the evidence. A trader who typed HAL and sees "HAL on NSE ·
  // ₹4,512" knows the run is anchored to the listing they meant before the
  // thesis exists; "no name resolved" tells them, equally usefully, that this
  // is about to be a field-building run rather than a single-stock one.
  step(
    "resolve",
    "done",
    !namesStocks
      ? "No stock named — building the field"
      : resolved
        ? `${heuristicTicker} on ${resolved.exchange} · ${formatCurrency(resolved.price, resolved.currency)}`
        : "No listing priced yet",
  );

  const userContext = buildJarvisThesisUserContext({
    inputText,
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

  step("generate", "active");
  let rawResponse: string;
  try {
    const result = await meteredGenerateText({
      userId,
      feature: "thesis",
      system: JARVIS_THESIS_SYSTEM_PROMPT,
      prompt: userContext,
    });
    rawResponse = result.text;
  } catch (err) {
    throw new ThesisRunError(`Jarvis model call failed: ${errorMessage(err)}`);
  }
  if (!rawResponse) {
    throw new ThesisRunError("Jarvis returned an empty response");
  }
  step("generate", "done");

  step("parse", "active");
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
  if (namesStocks && modelTicker) {
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

  const mode = parsed.extraction.ok ? parsed.extraction.data.mode : "thesis_only";
  const title = parsed.extraction.ok ? parsed.extraction.data.title : null;
  step(
    "parse",
    "done",
    // The title is the first genuinely interesting thing the run knows, and it
    // is known exactly here. Better on screen than restating the mode.
    title ?? (extractedTicker ? `Anchored to ${extractedTicker}` : `Read as ${mode}`),
  );

  step("save", "active");

  // US-10 duplicate-thesis warning — informational only, never blocks.
  let duplicateWarning: ThesisCreated["duplicateWarning"] = null;
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
    input_text: inputText,
    markets,
    mode,
    stock_id: stockId,
    ticker: extractedTicker,
    // Null is fine and handled: `thesisTitle` falls back to the ticker and then
    // to "Untitled thesis". `title_edited` stays false — the model naming
    // something is not the trader choosing a name for it.
    title,
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
    throw new ThesisRunError(insertError?.message ?? "Failed to insert thesis row");
  }
  step("save", "done");

  return {
    thesis: insertedThesis,
    stockSuggestions: parsed.extraction.ok ? parsed.extraction.data.stock_suggestions : [],
    duplicateWarning,
  };
}

/**
 * Creates a thesis, streaming its progress as newline-delimited JSON.
 *
 * The run takes tens of seconds and used to be a single opaque `fetch`, which
 * is how a 60s timeout in production read to the trader as a minute of nothing
 * followed by an error. The body is now a line per step, written as each one
 * finishes — see `lib/thesis-progress.ts` for the shape and for why there is no
 * percentage in it.
 *
 * WHERE THE STATUS CODE STILL LIVES: every guard that can refuse cheaply — bad
 * JSON, invalid input, no session, no budget — runs BEFORE the stream opens and
 * still answers with its own status. That is the half a caller retries on, and
 * it must stay machine-readable. Once the first byte is written the status is
 * committed to 200, so a failure past that point (the model, the insert) comes
 * back as a terminal `failed` event carrying the same message the status
 * response used to carry.
 */
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ThesisProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const payload = await runThesis(
          { inputText: input_text, namesStocks: names_stocks, markets, userId: user.id },
          emit,
        );
        emit({ kind: "done", payload });
      } catch (err) {
        emit({ kind: "failed", error: errorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // A buffered proxy would hold every line until the run finished, which is
      // the exact failure this feature exists to remove. `no-transform` stops
      // compression middleware from coalescing, `X-Accel-Buffering` stops nginx.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Screen HUB-3's thesis list (Task 21) — newest first. */
export async function GET() {
  try {
    return NextResponse.json({ theses: await listTheses() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
