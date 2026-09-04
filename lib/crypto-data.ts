import { withRetry } from "@/lib/market-data";
import type { CryptoUniverseRow } from "@/lib/types";

/**
 * CoinGecko, for crypto holdings (0030).
 *
 * A SIBLING of `lib/market-data.ts`, not a branch inside it. The two share
 * nothing but `withRetry`: Yahoo is per-symbol and exchange-suffixed, CoinGecko
 * is batched and currency-native, and `resolveYahooSymbol` is never called for
 * a coin. Folding them together would produce a function whose every line is an
 * `if` on asset class.
 *
 * Two properties of the API make this cheap. `/simple/price` is BATCHED, so one
 * request prices every coin held in a currency; and it takes `vs_currency`
 * NATIVELY, so a coin in a rupee book prices in rupees and the existing
 * per-currency totals (0021) do the rest with no FX conversion anywhere.
 *
 * Auth is the `x-cg-demo-api-key` HEADER against api.coingecko.com. A Pro key
 * uses a different header AND a different host, so it is not a drop-in swap.
 * Demo tier allows 100 calls/min and 10,000 credits/month; hourly polling of a
 * handful of coins uses roughly 7-15% of that.
 */

const BASE = "https://api.coingecko.com/api/v3";

export class CryptoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoDataError";
  }
}

/**
 * The synthetic `stocks.yahoo_symbol` for a coin priced in one currency.
 *
 * `stocks` carries `last_price` and `currency` on the row, so the grain has to
 * be (coin, currency) or an INR book and a USD book holding the same coin
 * cannot both be right. Real Yahoo symbols are uppercase and contain no colons,
 * so this namespace can never collide with one.
 *
 * The column is named `yahoo_symbol` and this is not a Yahoo symbol. That is a
 * deliberate lie, and it buys the whole existing pipeline — the `onConflict:
 * "yahoo_symbol"` upsert, `last_price_at` staleness, every alert trigger —
 * unchanged. The alternative costs a branch in roughly fifteen call sites.
 */
export function cryptoStockKey(coingeckoId: string, currency: string): string {
  return `coingecko:${coingeckoId.toLowerCase()}:${currency.toLowerCase()}`;
}

function apiKey(): string {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) {
    // Refuses rather than falling back to the keyless public tier. Unkeyed
    // requests are rate-limited far harder and would fail intermittently under
    // hourly polling — an outage that looks like flakiness is worse to diagnose
    // than one that says what is wrong.
    throw new CryptoDataError(
      "COINGECKO_API_KEY is not set — crypto prices cannot be fetched.",
    );
  }
  return key;
}

/**
 * A GET with retries on the failures that retrying can actually fix.
 *
 * Only 5xx and transport errors are thrown from inside `withRetry`, so only
 * those get backed off and repeated. A 4xx is RETURNED and thrown once
 * afterwards, which matters most for 429: a rate limit will not clear in
 * 500ms, and retrying it twice spends two more calls out of a 10,000/month
 * allowance to learn the same thing. The hourly poll is the retry.
 */
async function getJson<T>(path: string): Promise<T> {
  // Read ONCE, before the retry loop. A missing env var is not going to appear
  // between attempts, so retrying it just delays the same error by 1.5s.
  const key = apiKey();

  const res = await withRetry(async () => {
    const r = await fetch(`${BASE}${path}`, {
      headers: { "x-cg-demo-api-key": key, accept: "application/json" },
    });
    if (r.status >= 500) {
      throw new CryptoDataError(`CoinGecko ${path} failed with HTTP ${r.status}`);
    }
    return r;
  });

  if (!res.ok) {
    throw new CryptoDataError(`CoinGecko ${path} failed with HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Current price per coin, keyed by CoinGecko id.
 *
 * A coin the response does not mention is OMITTED rather than defaulted. A
 * missing price must never read as a price of zero: `last_price` stays null and
 * the UI says "Price unavailable", which is true, where a zero would render a
 * holding as a total loss.
 */
export async function getCryptoPrices(
  ids: string[],
  currency: string,
): Promise<Map<string, { price: number; asOf: Date }>> {
  const out = new Map<string, { price: number; asOf: Date }>();
  if (ids.length === 0) return out;

  const vs = currency.toLowerCase();
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: vs,
    include_last_updated_at: "true",
  });

  const body = await getJson<Record<string, Record<string, number>>>(
    `/simple/price?${params.toString()}`,
  );

  for (const id of ids) {
    const row = body[id];
    const price = row?.[vs];
    if (typeof price !== "number") continue;
    const stamp = row.last_updated_at;
    out.set(id, {
      price,
      asOf: typeof stamp === "number" ? new Date(stamp * 1000) : new Date(),
    });
  }
  return out;
}

/** The top `limit` coins by market cap, ranked. Feeds `crypto_universe`. */
export async function fetchTopCoins(
  limit: number,
): Promise<Omit<CryptoUniverseRow, "refreshed_at">[]> {
  const params = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: String(limit),
    page: "1",
  });

  const body = await getJson<
    { id: string; symbol: string; name: string; market_cap_rank: number }[]
  >(`/coins/markets?${params.toString()}`);

  return body.map((c) => ({
    coingecko_id: c.id,
    // Upper-cased here so the ticker a trader types in a CSV matches what is
    // stored, without every call site remembering to normalise.
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    market_cap_rank: c.market_cap_rank,
  }));
}
