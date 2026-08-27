// Deno Edge Function — NOT part of the Next.js build/lint/test pipeline.
// Written and unit-tested (its pure logic, via `lib/trigger-logic.ts` +
// `lib/__tests__/trigger-logic.test.ts` on the Next.js side) in Task 11, but
// NOT deployed and NOT wired to a real `pg_cron` schedule yet — that happens
// later, directly with the user against the real Supabase project.
//
// Deno can't import from this repo's `/lib` (separate deployable, separate
// runtime), so every piece of logic below that conceptually mirrors a
// `/lib` module (`isMarketOpen`, `withRetry`, `evaluateTriggers`,
// `deriveStatus`, `isWithinDedupWindow`) is a hand-transcribed copy, not an
// import. See each module's/function's comment for its `/lib` counterpart
// and what, if anything, deliberately diverges.

import YahooFinance from "https://esm.sh/yahoo-finance2@3.15.4";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { isMarketOpen } from "./market-hours.ts";

/**
 * `yahoo-finance2`'s default export is a class (its type carries a `new
 * (...)` construct signature, per `lib/market-data.ts`'s identical note)
 * rather than a ready instance, so it must be instantiated once and reused,
 * not called as a namespace.
 */
const yahooFinance = new YahooFinance();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deno-local transcription of `lib/market-data.ts`'s `withRetry`. MUST stay
 * semantically identical: up to `retries` retries (default 2) after the
 * initial attempt, exponential backoff starting at `baseDelayMs` (default
 * 500ms, doubling per attempt: 500ms, then 1000ms), rethrows the last error
 * once exhausted. If Task 4 changes its retry/backoff shape, mirror the
 * change here.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        break;
      }
      const delayMs = baseDelayMs * 2 ** attempt;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function getQuote(
  yahooSymbol: string,
): Promise<{ price: number; asOf: Date }> {
  const quote = await withRetry(() => yahooFinance.quote(yahooSymbol));

  if (
    quote.regularMarketPrice === undefined ||
    quote.regularMarketPrice === null
  ) {
    throw new Error(`Quote for "${yahooSymbol}" has no regularMarketPrice`);
  }

  return {
    price: quote.regularMarketPrice,
    // `regularMarketTime` existing without a value is an edge case Yahoo
    // shouldn't produce in practice; fall back to "now" rather than
    // failing the whole call over a missing timestamp (matches
    // `lib/market-data.ts#getQuote`'s exact handling).
    asOf: quote.regularMarketTime ?? new Date(),
  };
}

type Market = "NSE" | "US";
type Exchange = "NSE" | "BSE" | "US";
type PositionAlertType =
  | "stop_loss_breached"
  | "trim_target_1_reached"
  | "trim_target_2_reached"
  | "time_exit_due";

type StockRow = { id: string; yahoo_symbol: string; exchange: Exchange };

type PositionRow = {
  id: string;
  ticker: string;
  stock_id: string;
  trade_plan_id: string;
};

type TradePlanRow = {
  id: string;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  time_exit_date: string | null;
};

type PositionAlertEvent =
  | { type: "stop_loss_breached"; details: { price: number; stop_loss: number } }
  | {
      type: "trim_target_1_reached" | "trim_target_2_reached";
      details: { price: number; tier: "target_1" | "target_2"; tier_price: number };
    }
  | { type: "time_exit_due"; details: { time_exit_date: string } };

/**
 * Deno-local transcription of the v1 trigger-evaluation shape, retargeted at
 * `trade_plans`. A position is, by definition, already entered — so unlike
 * v1's `alert_criteria` (which watched both not-yet-bought watchlist stocks
 * AND holdings), this only ever evaluates exit-side conditions: stop,
 * either fixed target tier, and the time-exit date. Entry-zone/recommendation
 * status (Jarvis Recommendation Tracker, spec US-22) is computed client-side
 * on page load, not here — see plan Task 16.
 */
function evaluatePositionTriggers(
  tradePlan: TradePlanRow,
  price: number,
  now: Date,
): PositionAlertEvent[] {
  const events: PositionAlertEvent[] = [];

  if (tradePlan.stop_loss !== null && price <= tradePlan.stop_loss) {
    events.push({
      type: "stop_loss_breached",
      details: { price, stop_loss: tradePlan.stop_loss },
    });
  }
  if (tradePlan.target_1 !== null && price >= tradePlan.target_1) {
    events.push({
      type: "trim_target_1_reached",
      details: { price, tier: "target_1", tier_price: tradePlan.target_1 },
    });
  }
  if (tradePlan.target_2 !== null && price >= tradePlan.target_2) {
    events.push({
      type: "trim_target_2_reached",
      details: { price, tier: "target_2", tier_price: tradePlan.target_2 },
    });
  }
  if (tradePlan.time_exit_date !== null) {
    const target = new Date(`${tradePlan.time_exit_date}T00:00:00Z`).getTime();
    const nowUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (nowUtcMidnight >= target) {
      events.push({
        type: "time_exit_due",
        details: { time_exit_date: tradePlan.time_exit_date },
      });
    }
  }

  return events;
}

/** Same 20-hour dedup window as v1 (`lib/trigger-logic.ts#isWithinDedupWindow`). */
function isWithinDedupWindow(lastTriggeredAt: string, now: Date, windowHours = 20): boolean {
  const diffMs = now.getTime() - new Date(lastTriggeredAt).getTime();
  return diffMs < windowHours * 60 * 60 * 1000;
}

// deno-lint-ignore no-explicit-any
type SupabaseClientAny = any;

/** Inserts one `position_alerts` row per event not already logged within the dedup window. */
async function logPositionAlerts(
  supabase: SupabaseClientAny,
  positionId: string,
  events: PositionAlertEvent[],
  now: Date,
): Promise<void> {
  for (const event of events) {
    const { data: existing, error: existingError } = await supabase
      .from("position_alerts")
      .select("triggered_at")
      .eq("position_id", positionId)
      .eq("alert_type", event.type)
      .order("triggered_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error(`poll-prices: dedup check failed for position ${positionId}/${event.type}`, existingError);
      continue;
    }
    if (existing && isWithinDedupWindow(existing.triggered_at, now)) {
      continue;
    }

    const { error: insertError } = await supabase.from("position_alerts").insert({
      position_id: positionId,
      alert_type: event.type,
      triggered_at: now.toISOString(),
      details: event.details,
    });
    if (insertError) {
      console.error(`poll-prices: insert failed for position ${positionId}/${event.type}`, insertError);
    }
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const marketParam = url.searchParams.get("market");

  if (marketParam !== "NSE" && marketParam !== "US") {
    return jsonResponse({ error: 'market query param must be "NSE" or "US"' }, 400);
  }
  const market: Market = marketParam;

  if (!isMarketOpen(market, new Date())) {
    return jsonResponse({ skipped: true, reason: "market closed" }, 200);
  }

  const supabase = createAdminClient();
  const exchanges: Exchange[] = market === "NSE" ? ["NSE", "BSE"] : ["US"];

  const { data: activePositions, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker, stock_id, trade_plan_id")
    .eq("status", "active");

  if (positionsError) {
    return jsonResponse({ error: positionsError.message }, 500);
  }
  const positionRows = (activePositions ?? []) as PositionRow[];
  if (positionRows.length === 0) {
    return jsonResponse({ processed: 0 }, 200);
  }

  const stockIds = [...new Set(positionRows.map((p) => p.stock_id))];
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("id, yahoo_symbol, exchange")
    .in("id", stockIds);
  if (stocksError) {
    return jsonResponse({ error: stocksError.message }, 500);
  }
  const stockById = new Map<string, StockRow>((stocks ?? []).map((s: StockRow) => [s.id, s]));

  // Only process positions whose stock trades on the exchange(s) this
  // invocation's `market` param covers — same split as v1's NSE+BSE-vs-US
  // pg_cron windows.
  const relevantPositions = positionRows.filter((p) => {
    const stock = stockById.get(p.stock_id);
    return stock !== undefined && exchanges.includes(stock.exchange);
  });
  if (relevantPositions.length === 0) {
    return jsonResponse({ processed: 0 }, 200);
  }

  const tradePlanIds = [...new Set(relevantPositions.map((p) => p.trade_plan_id))];
  const { data: tradePlans, error: tradePlansError } = await supabase
    .from("trade_plans")
    .select("id, stop_loss, target_1, target_2, time_exit_date")
    .in("id", tradePlanIds);
  if (tradePlansError) {
    return jsonResponse({ error: tradePlansError.message }, 500);
  }
  const tradePlanById = new Map<string, TradePlanRow>((tradePlans ?? []).map((t: TradePlanRow) => [t.id, t]));

  const now = new Date();
  let processed = 0;

  for (const position of relevantPositions) {
    const stock = stockById.get(position.stock_id)!;
    const tradePlan = tradePlanById.get(position.trade_plan_id);
    if (!tradePlan) continue;

    try {
      const quote = await getQuote(stock.yahoo_symbol);
      await supabase
        .from("stocks")
        .update({ last_price: quote.price, last_price_at: quote.asOf.toISOString() })
        .eq("id", stock.id);

      const events = evaluatePositionTriggers(tradePlan, quote.price, now);
      await logPositionAlerts(supabase, position.id, events, now);
      processed++;
    } catch (err) {
      // Isolation guarantee, same as v1: one position's failure must never
      // abort the rest of the batch.
      console.error(`poll-prices: failed to process position ${position.ticker} (${position.id})`, err);
    }
  }

  return jsonResponse({ processed }, 200);
});
