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

type Market = "NSE" | "US";
type StockType = "watchlist" | "holding";
type Exchange = "NSE" | "BSE" | "US";
type TriggerType =
  | "entry_zone_reached"
  | "stop_loss_breached"
  | "trim_target_reached"
  | "earnings_approaching"
  | "reassess_due";

type StockRow = {
  id: string;
  ticker: string;
  yahoo_symbol: string;
  exchange: Exchange;
  type: StockType;
  status: string;
  consecutive_failure_count: number;
  stale_since: string | null;
};

type AlertCriteriaRow = {
  id: string;
  stock_id: string;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  trim_targets: { price: number; pct_of_position: number }[];
  earnings_date: string | null;
  reassessment_date: string | null;
  time_exit_date: string | null;
};

type TriggerEvent =
  | {
      type: "entry_zone_reached";
      details: { price: number; entry_low: number; entry_high: number };
    }
  | {
      type: "stop_loss_breached";
      details: { price: number; stop_loss: number };
    }
  | {
      type: "trim_target_reached";
      details: {
        price: number;
        tier_price: number;
        pct_of_position: number;
        tier_index: number;
      };
    }
  | {
      type: "earnings_approaching";
      details: { earnings_date: string; days_out: number };
    }
  | {
      type: "reassess_due";
      details: { reassess_date: string };
    };

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

/**
 * Deno-local transcription of `lib/trigger-logic.ts`'s `evaluateTriggers`.
 * See that file for the full rationale/precedence writeup — this copy must
 * stay behaviorally identical; it exists here only because Deno can't
 * `import` from `/lib`.
 */
function daysBetweenDateOnly(dateStr: string, now: Date): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const nowUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target - nowUtcMidnight) / msPerDay);
}

function evaluateTriggers(
  stock: { type: StockType },
  alertCriteria: AlertCriteriaRow,
  price: number,
  now: Date,
): TriggerEvent[] {
  const events: TriggerEvent[] = [];

  if (
    stock.type === "watchlist" &&
    alertCriteria.entry_low !== null &&
    alertCriteria.entry_high !== null &&
    price >= alertCriteria.entry_low &&
    price <= alertCriteria.entry_high
  ) {
    events.push({
      type: "entry_zone_reached",
      details: {
        price,
        entry_low: alertCriteria.entry_low,
        entry_high: alertCriteria.entry_high,
      },
    });
  }

  if (
    stock.type === "holding" &&
    alertCriteria.stop_loss !== null &&
    price <= alertCriteria.stop_loss
  ) {
    events.push({
      type: "stop_loss_breached",
      details: { price, stop_loss: alertCriteria.stop_loss },
    });
  }

  if (stock.type === "holding") {
    for (const [tierIndex, tier] of alertCriteria.trim_targets.entries()) {
      if (price >= tier.price) {
        events.push({
          type: "trim_target_reached",
          details: {
            price,
            tier_price: tier.price,
            pct_of_position: tier.pct_of_position,
            tier_index: tierIndex,
          },
        });
      }
    }
  }

  if (alertCriteria.earnings_date !== null) {
    const daysOut = daysBetweenDateOnly(alertCriteria.earnings_date, now);
    if (daysOut >= 0 && daysOut <= 3) {
      events.push({
        type: "earnings_approaching",
        details: { earnings_date: alertCriteria.earnings_date, days_out: daysOut },
      });
    }
  }

  const reassessDate =
    alertCriteria.reassessment_date ?? alertCriteria.time_exit_date;
  if (reassessDate !== null) {
    const daysOut = daysBetweenDateOnly(reassessDate, now);
    if (daysOut <= 0) {
      events.push({
        type: "reassess_due",
        details: { reassess_date: reassessDate },
      });
    }
  }

  return events;
}

/**
 * Deno-local transcription of `lib/trigger-logic.ts`'s `deriveStatus`.
 * Precedence: Stop Hit > Trim Hit > Reassess Due > In Entry Zone >
 * (Holding | Watching). See `lib/trigger-logic.ts` for the full rationale.
 */
function deriveStatus(
  stockType: StockType,
  firedTriggerTypes: TriggerType[],
): string {
  const has = (t: TriggerType) => firedTriggerTypes.includes(t);

  if (has("stop_loss_breached")) return "Stop Hit";
  if (has("trim_target_reached")) return "Trim Hit";
  if (has("reassess_due")) return "Reassess Due";
  if (has("entry_zone_reached")) return "In Entry Zone";
  return stockType === "holding" ? "Holding" : "Watching";
}

/**
 * Deno-local transcription of `lib/trigger-logic.ts`'s
 * `isWithinDedupWindow`. 20-hour window per task-11-brief.md.
 */
function isWithinDedupWindow(
  lastTriggeredAt: string,
  now: Date,
  windowHours = 20,
): boolean {
  const diffMs = now.getTime() - new Date(lastTriggeredAt).getTime();
  return diffMs < windowHours * 60 * 60 * 1000;
}

// deno-lint-ignore no-explicit-any
type SupabaseClientAny = any;

/**
 * Inserts one `alert_log` row per fired event, skipping any
 * `(stock_id, trigger_type)` pair that already has a row triggered within
 * the last 20 hours (the dedup guard — see
 * `lib/trigger-logic.ts#isWithinDedupWindow`). Returns the trigger types
 * that were actually logged (not deduped); callers should still pass
 * `events` (not this return value) into `deriveStatus`, since status should
 * reflect the currently-true condition regardless of whether it was
 * re-logged this cycle.
 *
 * Typed against a minimal structural shape (`{ type, details }`) rather
 * than `TriggerEvent` specifically, so `recordFetchFailure`'s `data_stale`
 * event — which never comes out of `evaluateTriggers` and so isn't a member
 * of the `TriggerEvent` union — can share this same dedup-checked insert
 * path instead of duplicating it.
 */
async function logAlerts(
  supabase: SupabaseClientAny,
  stockId: string,
  events: { type: string; details: unknown }[],
  now: Date,
): Promise<void> {
  for (const event of events) {
    const { data: existing, error: existingError } = await supabase
      .from("alert_log")
      .select("triggered_at")
      .eq("stock_id", stockId)
      .eq("trigger_type", event.type)
      .order("triggered_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error(
        `poll-prices: failed to check dedup window for stock ${stockId} / ${event.type}`,
        existingError,
      );
      continue;
    }

    if (existing && isWithinDedupWindow(existing.triggered_at, now)) {
      continue;
    }

    const { error: insertError } = await supabase.from("alert_log").insert({
      stock_id: stockId,
      trigger_type: event.type,
      triggered_at: now.toISOString(),
      details: event.details,
    });

    if (insertError) {
      console.error(
        `poll-prices: failed to insert alert_log row for stock ${stockId} / ${event.type}`,
        insertError,
      );
    }
  }
}

/**
 * Records one failed quote fetch: increments `consecutive_failure_count`,
 * and sets `stale_since` the moment the count first crosses the 3-failure
 * threshold (never overwrites an already-set `stale_since` — that's still
 * the start of the same stale episode).
 *
 * Also fires a `data_stale` `alert_log` row, but ONLY on the cycle that
 * actually crosses the threshold (`crossingStaleThreshold`) — not on every
 * subsequent failed poll while the stock stays stale. This is deliberately
 * gated in addition to (not instead of) `logAlerts`'s own 20-hour dedup
 * guard: gating here means a stock that's already stale doesn't even issue
 * the dedup-check query on every 15-30 minute cycle, while the dedup guard
 * remains the actual correctness backstop (e.g. if `stale_since` were ever
 * cleared and re-crossed within the same 20-hour window).
 */
async function recordFetchFailure(
  supabase: SupabaseClientAny,
  stock: StockRow,
  now: Date,
  err: unknown,
): Promise<void> {
  const newFailureCount = stock.consecutive_failure_count + 1;
  const update: Record<string, unknown> = {
    consecutive_failure_count: newFailureCount,
  };
  const crossingStaleThreshold = newFailureCount >= 3 && !stock.stale_since;
  if (crossingStaleThreshold) {
    update.stale_since = now.toISOString();
  }

  const { error } = await supabase
    .from("stocks")
    .update(update)
    .eq("id", stock.id);

  if (error) {
    console.error(
      `poll-prices: failed to record fetch failure for stock ${stock.id}`,
      error,
    );
  }

  if (crossingStaleThreshold) {
    await logAlerts(
      supabase,
      stock.id,
      [
        {
          type: "data_stale",
          details: {
            consecutive_failure_count: newFailureCount,
            last_error: err instanceof Error ? err.message : String(err),
          },
        },
      ],
      now,
    );
  }
}

/**
 * Fetches the live quote and refreshes `stocks.last_price`/`last_price_at`/
 * `consecutive_failure_count`/`stale_since` for ONE active stock,
 * regardless of whether it has an active `alert_criteria` row — a
 * freshly-added stock that hasn't been through a Jarvis run yet must not
 * show a frozen add-time price forever just because there's nothing yet to
 * evaluate triggers against.
 *
 * `alertCriteria` is optional: only when it's present does this also
 * evaluate triggers, log any fired `alert_log` rows, and derive/update
 * `status` — with no active criteria there is nothing to compare the price
 * against, so that whole block is skipped and `status` is left untouched.
 */
async function processStock(
  supabase: SupabaseClientAny,
  stock: StockRow,
  alertCriteria: AlertCriteriaRow | undefined,
  now: Date,
): Promise<void> {
  let quote: { price: number; asOf: Date };
  try {
    quote = await getQuote(stock.yahoo_symbol);
  } catch (err) {
    console.error(
      `poll-prices: quote fetch failed for ${stock.ticker} (${stock.yahoo_symbol}) after retries`,
      err,
    );
    await recordFetchFailure(supabase, stock, now, err);
    return;
  }

  const update: Record<string, unknown> = {
    last_price: quote.price,
    last_price_at: quote.asOf.toISOString(),
    consecutive_failure_count: 0,
    stale_since: null,
  };

  if (alertCriteria) {
    const events = evaluateTriggers(
      { type: stock.type },
      alertCriteria,
      quote.price,
      now,
    );

    await logAlerts(supabase, stock.id, events, now);

    update.status = deriveStatus(
      stock.type,
      events.map((e) => e.type) as TriggerType[],
    );
  }

  const { error: updateError } = await supabase
    .from("stocks")
    .update(update)
    .eq("id", stock.id);

  if (updateError) {
    console.error(
      `poll-prices: failed to update stock row for ${stock.ticker}`,
      updateError,
    );
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const marketParam = url.searchParams.get("market");

  if (marketParam !== "NSE" && marketParam !== "US") {
    return jsonResponse(
      { error: 'market query param must be "NSE" or "US"' },
      400,
    );
  }
  const market: Market = marketParam;

  if (!isMarketOpen(market, new Date())) {
    return jsonResponse({ skipped: true, reason: "market closed" }, 200);
  }

  const supabase = createAdminClient();
  const exchanges: Exchange[] = market === "NSE" ? ["NSE", "BSE"] : ["US"];

  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select(
      "id, ticker, yahoo_symbol, exchange, type, status, consecutive_failure_count, stale_since",
    )
    .is("deleted_at", null)
    .in("exchange", exchanges);

  if (stocksError) {
    return jsonResponse({ error: stocksError.message }, 500);
  }

  const stockRows = (stocks ?? []) as StockRow[];
  if (stockRows.length === 0) {
    return jsonResponse({ processed: 0 }, 200);
  }

  const stockIds = stockRows.map((s) => s.id);

  const { data: activeCriteria, error: criteriaError } = await supabase
    .from("alert_criteria")
    .select(
      "id, stock_id, entry_low, entry_high, stop_loss, trim_targets, earnings_date, reassessment_date, time_exit_date",
    )
    .in("stock_id", stockIds)
    .eq("is_active", true);

  if (criteriaError) {
    return jsonResponse({ error: criteriaError.message }, 500);
  }

  const criteriaByStockId = new Map<string, AlertCriteriaRow>(
    ((activeCriteria ?? []) as AlertCriteriaRow[]).map((c) => [
      c.stock_id,
      c,
    ]),
  );

  const now = new Date();
  let processed = 0;

  for (const stock of stockRows) {
    // No active alert_criteria row is NOT a reason to skip this stock
    // entirely (a freshly-added stock may not have run through Jarvis yet)
    // — `processStock` always refreshes the price/timestamp, and only
    // skips trigger-evaluation/alert_log/status-derivation when
    // `alertCriteria` is `undefined`.
    const alertCriteria = criteriaByStockId.get(stock.id);

    try {
      await processStock(supabase, stock, alertCriteria, now);
      processed++;
    } catch (err) {
      // Isolation guarantee: one stock's unexpected failure (a DB error
      // outside the quote-fetch path, a bug, etc.) must never abort the
      // rest of the batch.
      console.error(
        `poll-prices: unexpected error processing stock ${stock.ticker} (${stock.id})`,
        err,
      );
    }
  }

  return jsonResponse({ processed }, 200);
});
