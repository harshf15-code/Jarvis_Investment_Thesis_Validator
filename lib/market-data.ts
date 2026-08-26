import YahooFinance from "yahoo-finance2";

import type { ExchangeCode } from "@/lib/types";

/**
 * `yahoo-finance2`'s default export is a class (its type carries a `new
 * (...)` construct signature plus a set of `never`-returning deprecated
 * methods for the old "call it directly" API) rather than a ready instance,
 * so it must be instantiated once and reused, not called as a namespace.
 */
const yahooFinance = new YahooFinance();

/**
 * Thrown when a yahoo-finance2 response is missing data this app needs
 * (e.g. a quote with no `regularMarketPrice`). Distinguishes "we talked to
 * Yahoo and got a shape we can't use" from a network/transport failure.
 */
export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}

/**
 * Maps an internal ticker + exchange to the symbol Yahoo Finance expects:
 * `.NS` suffix for NSE, `.BO` for BSE, no suffix for US. The ticker is
 * uppercased in all three cases.
 */
export function resolveYahooSymbol(
  ticker: string,
  exchange: ExchangeCode,
): string {
  const upperTicker = ticker.toUpperCase();
  switch (exchange) {
    case "NSE":
      return `${upperTicker}.NS`;
    case "BSE":
      return `${upperTicker}.BO`;
    case "US":
      return upperTicker;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared retry wrapper for every yahoo-finance2 call in this file.
 *
 * Semantics: up to `retries` retries (default 2) after the initial attempt
 * (so 3 attempts total by default), with exponential backoff between
 * attempts starting at `baseDelayMs` (default 500ms: waits 500ms after the
 * 1st failure, 1000ms after the 2nd, doubling each time). Rethrows the last
 * error once retries are exhausted.
 *
 * IMPORTANT: Task 11's Edge Functions run in Deno and can't import from
 * `/lib`, so they reimplement this exact logic as their own copy rather
 * than importing it. That copy must conceptually match this one — same
 * attempt count (`retries + 1`) and same backoff shape (exponential,
 * starting at `baseDelayMs`, doubling per attempt). If you change the
 * retry/backoff behavior here, update the Task 11 copy too.
 */
export async function withRetry<T>(
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

/**
 * Latest quoted price for `yahooSymbol`.
 */
export async function getQuote(
  yahooSymbol: string,
): Promise<{ price: number; asOf: Date }> {
  const quote = await withRetry(() => yahooFinance.quote(yahooSymbol));

  if (
    quote.regularMarketPrice === undefined ||
    quote.regularMarketPrice === null
  ) {
    throw new MarketDataError(
      `Quote for "${yahooSymbol}" has no regularMarketPrice`,
    );
  }

  return {
    price: quote.regularMarketPrice,
    // regularMarketPrice existing without regularMarketTime is an edge
    // case Yahoo shouldn't produce in practice; fall back to "now" rather
    // than failing the whole call over a missing timestamp.
    asOf: quote.regularMarketTime ?? new Date(),
  };
}

function toDateKey(date: Date): string {
  // Yahoo's daily-interval chart `date` values represent a trading day
  // rather than a specific intraday instant, so a UTC-based slice avoids
  // the host machine's local timezone shifting the date by a day.
  return date.toISOString().slice(0, 10);
}

/**
 * Daily OHLCV history for `yahooSymbol`, oldest first.
 *
 * `opts.days` (default 400, enough to cover a 200-day SMA with headroom
 * for non-trading days) controls how far back `period1` is set from now.
 * Days with any null OHLCV field (e.g. a halted-trading day) are dropped
 * rather than surfaced with fabricated zeros.
 */
export async function getHistoricalOHLCV(
  yahooSymbol: string,
  opts?: { days?: number },
): Promise<
  { time: string; open: number; high: number; low: number; close: number; volume: number }[]
> {
  const days = opts?.days ?? 400;
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await withRetry(() =>
    yahooFinance.chart(yahooSymbol, { period1, interval: "1d" }),
  );

  const rows: {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[] = [];

  for (const quote of result.quotes) {
    if (
      quote.open === null ||
      quote.high === null ||
      quote.low === null ||
      quote.close === null ||
      quote.volume === null
    ) {
      continue;
    }
    rows.push({
      time: toDateKey(quote.date),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
    });
  }

  return rows;
}

/**
 * Modules pulled for `getFundamentals`, and the subset of each module's
 * fields flattened into the result. `yahoo-finance2`'s response shape
 * varies by ticker/exchange/instrument type (e.g. ETFs and ADRs omit
 * fields plain equities have), so this is a curated "reasonable standard
 * subset" rather than every field the modules can return, and any field
 * absent from the response for a given symbol is simply omitted from the
 * result instead of failing the call.
 */
const FUNDAMENTALS_FIELDS = {
  summaryDetail: [
    "trailingPE",
    "forwardPE",
    "marketCap",
    "fiftyTwoWeekLow",
    "fiftyTwoWeekHigh",
    "dividendYield",
    "beta",
  ],
  defaultKeyStatistics: [
    "trailingEps",
    "forwardEps",
    "priceToBook",
    "pegRatio",
    "profitMargins",
    "enterpriseValue",
  ],
  financialData: [
    "currentPrice",
    "revenueGrowth",
    "returnOnEquity",
    "returnOnAssets",
    "debtToEquity",
    "grossMargins",
    "operatingMargins",
    "totalRevenue",
  ],
} as const;

function pickFields(
  source: Record<string, unknown> | undefined,
  fields: readonly string[],
  into: Record<string, string | number>,
): void {
  if (!source) {
    return;
  }
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "number" || typeof value === "string") {
      into[field] = value;
    } else if (value instanceof Date) {
      into[field] = value.toISOString();
    }
    // Any other type (undefined, null, object, boolean) is omitted rather
    // than coerced, per this function's `Record<string, string | number>`
    // contract.
  }
}

/**
 * Flattened fundamentals snapshot for `yahooSymbol` (P/E, market cap,
 * 52-week high/low, revenue growth, etc. where available). See
 * `FUNDAMENTALS_FIELDS` for the exact fields pulled from each module.
 *
 * If Yahoo omits an entire module for this symbol (e.g. `financialData`
 * missing for some non-equity instruments), that module's fields are just
 * absent from the result — this does not throw.
 */
export async function getFundamentals(
  yahooSymbol: string,
): Promise<Record<string, string | number>> {
  const summary = await withRetry(() =>
    yahooFinance.quoteSummary(yahooSymbol, {
      modules: ["summaryDetail", "defaultKeyStatistics", "financialData"],
    }),
  );

  const result: Record<string, string | number> = {};
  pickFields(
    summary.summaryDetail as Record<string, unknown> | undefined,
    FUNDAMENTALS_FIELDS.summaryDetail,
    result,
  );
  pickFields(
    summary.defaultKeyStatistics as Record<string, unknown> | undefined,
    FUNDAMENTALS_FIELDS.defaultKeyStatistics,
    result,
  );
  pickFields(
    summary.financialData as Record<string, unknown> | undefined,
    FUNDAMENTALS_FIELDS.financialData,
    result,
  );

  return result;
}
