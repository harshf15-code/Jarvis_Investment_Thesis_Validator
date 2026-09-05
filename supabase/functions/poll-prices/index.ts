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
 * once exhausted, and gives up immediately on a permanent failure. If Task 4
 * changes its retry/backoff shape, mirror the change here.
 *
 * Permanent means 404 and only 404 — an allow-list, not "4xx except the
 * retryable ones". See `lib/market-data.ts` for why 401/403 must keep their
 * retries; on this path in particular, a poll that gives up on a stale-session
 * 401 leaves every holding un-priced until the next scheduled run.
 *
 * The short-circuit is a no-op for THIS file's only caller: `quote()` resolves
 * `undefined` for a symbol Yahoo does not know rather than throwing, so no 404
 * reaches it. It is transcribed anyway because the two copies drifting is the
 * failure mode this comment exists to prevent.
 */
const PERMANENT_STATUSES = new Set([404]);

function isPermanentFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" && PERMANENT_STATUSES.has(code);
}

/**
 * See above.
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
      // A permanent answer is already the answer. Retrying it only delays it.
      if (isPermanentFailure(err)) {
        break;
      }
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
): Promise<{ price: number; asOf: Date; currency: string | null }> {
  const quote = await withRetry(() => yahooFinance.quote(yahooSymbol));

  if (
    quote.regularMarketPrice === undefined ||
    quote.regularMarketPrice === null
  ) {
    throw new Error(`Quote for "${yahooSymbol}" has no regularMarketPrice`);
  }

  return {
    price: quote.regularMarketPrice,
    currency: quote.currency ?? null,
    // `regularMarketTime` existing without a value is an edge case Yahoo
    // shouldn't produce in practice; fall back to "now" rather than
    // failing the whole call over a missing timestamp (matches
    // `lib/market-data.ts#getQuote`'s exact handling).
    asOf: quote.regularMarketTime ?? new Date(),
  };
}

type Market = "NSE" | "US" | "CRYPTO";
type Exchange = "NSE" | "BSE" | "US" | "CRYPTO";
type PositionAlertType =
  | "stop_loss_breached"
  | "trim_target_1_reached"
  | "trim_target_2_reached"
  | "time_exit_due";

type StockRow = {
  id: string;
  yahoo_symbol: string;
  exchange: Exchange;
  /** 0030. Null for every equity. */
  coingecko_id: string | null;
  /** The currency this ROW is priced in — for a coin, its book's. */
  currency: string;
};

/**
 * Prices every crypto stock row, batched by currency.
 *
 * Deno cannot import from `/lib`, which is why `withRetry` is reimplemented in
 * this file and why this is not `lib/crypto-data.ts`. It reads `coingecko_id`
 * and `currency` straight off the row rather than parsing them back out of the
 * synthetic `yahoo_symbol` — the columns are there, and parsing a key we
 * generated would be a second place for its format to matter.
 *
 * One request per distinct currency, not per coin: `/simple/price` takes one
 * `vs_currencies` and returns it for every id in the batch. Two books in two
 * currencies is two calls.
 */
async function fetchCryptoPrices(
  stocks: StockRow[],
): Promise<Map<string, { price: number; asOf: Date }>> {
  const out = new Map<string, { price: number; asOf: Date }>();
  const key = Deno.env.get("COINGECKO_API_KEY");
  if (!key) {
    console.error("poll-prices: COINGECKO_API_KEY is not set; no crypto row can be priced");
    return out;
  }

  const byCurrency = new Map<string, StockRow[]>();
  for (const stock of stocks) {
    if (!stock.coingecko_id) continue;
    const list = byCurrency.get(stock.currency) ?? [];
    list.push(stock);
    byCurrency.set(stock.currency, list);
  }

  for (const [currency, group] of byCurrency) {
    const vs = currency.toLowerCase();
    const ids = [...new Set(group.map((s) => s.coingecko_id!))];
    const params = new URLSearchParams({
      ids: ids.join(","),
      vs_currencies: vs,
      include_last_updated_at: "true",
    });

    try {
      // Retried only on 5xx, matching `lib/crypto-data.ts`: a 429 will not
      // clear inside a backoff, and retrying it spends more of a metered
      // monthly quota to learn the same thing. The next hourly run is the retry.
      const res = await withRetry(async () => {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`, {
          headers: { "x-cg-demo-api-key": key, accept: "application/json" },
        });
        if (r.status >= 500) throw new Error(`CoinGecko returned ${r.status}`);
        return r;
      });
      if (!res.ok) {
        console.error(`poll-prices: CoinGecko returned ${res.status} for ${currency}`);
        continue;
      }
      const body = (await res.json()) as Record<string, Record<string, number>>;
      for (const stock of group) {
        const quoted = body[stock.coingecko_id!]?.[vs];
        if (typeof quoted !== "number") continue;
        const stamp = body[stock.coingecko_id!]?.last_updated_at;
        out.set(stock.id, {
          price: quoted,
          asOf: typeof stamp === "number" ? new Date(stamp * 1000) : new Date(),
        });
      }
    } catch (err) {
      // One currency failing must not abort the others — same isolation rule
      // the per-position loop below follows.
      console.error(`poll-prices: crypto fetch failed for ${currency}`, err);
    }
  }
  return out;
}

type PositionRow = {
  id: string;
  ticker: string;
  stock_id: string;
  trade_plan_id: string;
  /** Carried onto every alert this position produces — see `logPositionAlerts`. */
  user_id: string;
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

/**
 * Inserts one `position_alerts` row per event not already logged within the
 * dedup window.
 *
 * `userId` has to be passed in and written explicitly. Every other writer of
 * this table gets the owner from the column's `default auth.uid()`, but this
 * function runs on the service-role key with no session, where `auth.uid()`
 * is NULL. Since 0015 the column is NOT NULL, so omitting it fails the insert
 * outright rather than creating an alert no RLS policy can match and no digest
 * will ever send. The value is carried down from the position that produced
 * the alert.
 */
async function logPositionAlerts(
  supabase: SupabaseClientAny,
  positionId: string,
  userId: string,
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
      user_id: userId,
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

  if (marketParam !== "NSE" && marketParam !== "US" && marketParam !== "CRYPTO") {
    return jsonResponse({ error: 'market query param must be "NSE", "US" or "CRYPTO"' }, 400);
  }
  const market: Market = marketParam;

  // Crypto has no session, so asking whether the market is open is not a check
  // that passes — it is the wrong question. `isMarketOpen` knows two equity
  // sessions and would answer "closed" all weekend for an asset that trades
  // straight through it, which is exactly when a stop is most likely to breach
  // unwatched. This job runs hourly, seven days.
  if (market !== "CRYPTO" && !isMarketOpen(market, new Date())) {
    return jsonResponse({ skipped: true, reason: "market closed" }, 200);
  }

  const supabase = createAdminClient();
  const exchanges: Exchange[] =
    market === "NSE" ? ["NSE", "BSE"] : market === "CRYPTO" ? ["CRYPTO"] : ["US"];

  const { data: activePositions, error: positionsError } = await supabase
    .from("positions")
    .select("id, ticker, stock_id, trade_plan_id, user_id")
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
    .select("id, yahoo_symbol, exchange, coingecko_id, currency")
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

  // Fetched BEFORE the loop and in one batch per currency, unlike the equity
  // path's per-symbol `getQuote`. The endpoint prices every id in a request, so
  // a per-position call would be strictly more requests for the same answer.
  const cryptoPrices =
    market === "CRYPTO"
      ? await fetchCryptoPrices(
          [...new Set(relevantPositions.map((p) => p.stock_id))]
            .map((id) => stockById.get(id))
            .filter((s): s is StockRow => s !== undefined),
        )
      : new Map<string, { price: number; asOf: Date }>();

  const now = new Date();
  let processed = 0;

  for (const position of relevantPositions) {
    const stock = stockById.get(position.stock_id)!;
    const tradePlan = tradePlanById.get(position.trade_plan_id);
    if (!tradePlan) continue;

    try {
      // A coin's price came from the batch above; an equity's is fetched here.
      // Both produce the same shape, so everything below this point — the
      // stock update, the trigger evaluation, the alert write — is identical
      // for the two asset classes and has no idea which it is looking at.
      const quote =
        market === "CRYPTO"
          ? cryptoPrices.get(stock.id)
          : await getQuote(stock.yahoo_symbol);
      if (!quote) {
        // Priced by nobody this run: CoinGecko omitted it, or the whole
        // currency's request failed. Leaving `last_price` alone is right — the
        // stored price with its older `last_price_at` is honest, where writing
        // a zero would read as a total loss and fire every stop in the book.
        continue;
      }

      await supabase
        .from("stocks")
        .update({
          last_price: quote.price,
          last_price_at: quote.asOf.toISOString(),
          // Re-asserted from the quote rather than written once and trusted
          // forever (0021). This is the path that runs most often, so it is
          // the one that actually corrects a row seeded from `exchange`.
          // A coin has no such correction to make: its currency is the book's,
          // and CoinGecko was ASKED for that currency rather than reporting one.
          ...("currency" in quote && quote.currency ? { currency: quote.currency } : {}),
        })
        .eq("id", stock.id);

      const events = evaluatePositionTriggers(tradePlan, quote.price, now);
      await logPositionAlerts(supabase, position.id, position.user_id, events, now);
      processed++;
    } catch (err) {
      // Isolation guarantee, same as v1: one position's failure must never
      // abort the rest of the batch.
      console.error(`poll-prices: failed to process position ${position.ticker} (${position.id})`, err);
    }
  }

  return jsonResponse({ processed }, 200);
});
