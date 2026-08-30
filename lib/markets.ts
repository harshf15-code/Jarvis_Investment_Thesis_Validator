import type { ExchangeCode, MarketCode } from "@/lib/types";

/**
 * The single source of truth for "which market is this thesis about".
 *
 * A market is NOT an exchange. India is one market served by two exchanges
 * (NSE and BSE); the US is one market and one exchange code here. The user
 * picks markets, the shortlist prompt is built from `exchanges`, and every
 * candidate the model returns is checked back against that same list — so the
 * universe the trader chose is the universe the memo is written from.
 *
 * `live: false` markets are deliberately visible but unselectable. Pricing
 * them needs currency support this app does not have: `stocks` has no currency
 * column, `exchange_code` is `NSE|BSE|US`, and the whole price path assumes a
 * candidate's number is comparable to every other candidate's. Showing a
 * ¥6,052 quote beside a $356 one — or worse, feeding it into stop-loss
 * geometry — is far more dangerous than showing nothing, so these stay off
 * until that work is actually done rather than shipping half-priced reports.
 */
export type MarketMeta = {
  label: string;
  /** Selectable today. `false` renders as "coming soon". */
  live: boolean;
  /** Exchanges whose listings belong to this market. Empty when not live. */
  exchanges: readonly ExchangeCode[];
  currency: string;
  /** Prefix used by the comparative grid and anywhere a price is rendered. */
  symbol: string;
  /** Locale for `toLocaleString` — India groups digits differently (1,00,000). */
  locale: string;
};

export const MARKETS: Record<MarketCode, MarketMeta> = {
  US: {
    label: "United States",
    live: true,
    exchanges: ["US"],
    currency: "USD",
    symbol: "$",
    locale: "en-US",
  },
  IN: {
    label: "India",
    live: true,
    exchanges: ["NSE", "BSE"],
    currency: "INR",
    symbol: "₹",
    locale: "en-IN",
  },
  CN: { label: "China", live: false, exchanges: [], currency: "CNY", symbol: "¥", locale: "zh-CN" },
  EU: { label: "Europe", live: false, exchanges: [], currency: "EUR", symbol: "€", locale: "en-GB" },
  EM: {
    label: "Emerging Markets",
    live: false,
    exchanges: [],
    currency: "USD",
    symbol: "$",
    locale: "en-US",
  },
};

/** Display order for the selector — live markets first, then the rest. */
export const MARKET_ORDER: MarketCode[] = ["US", "IN", "CN", "EU", "EM"];

export const LIVE_MARKETS: MarketCode[] = MARKET_ORDER.filter((m) => MARKETS[m].live);

export function isMarketCode(value: unknown): value is MarketCode {
  return typeof value === "string" && value in MARKETS;
}

export function isLiveMarket(value: unknown): value is MarketCode {
  return isMarketCode(value) && MARKETS[value].live;
}

/**
 * The exchanges a candidate for `market` may legitimately be listed on, in the
 * order the resolver should probe them. This is what keeps a Tokyo-listed name
 * out of a US run: there is no suffix in this list that would ever resolve it.
 */
export function exchangesFor(market: MarketCode): readonly ExchangeCode[] {
  return MARKETS[market].exchanges;
}

/**
 * Which market an already-resolved exchange belongs to. Used to backfill and
 * to sanity-check a candidate after it prices.
 */
export function marketForExchange(exchange: ExchangeCode): MarketCode {
  return exchange === "US" ? "US" : "IN";
}

/**
 * Price formatting for a market. Replaces the grid's old `exchange === "US" ?
 * "$" : "₹"` ternary, which silently labelled every non-US price as rupees —
 * fine while the universe was NSE/BSE/US, wrong the moment it is not.
 */
export function formatMarketPrice(value: number, market: MarketCode): string {
  const meta = MARKETS[market];
  return `${meta.symbol}${value.toLocaleString(meta.locale, { maximumFractionDigits: 2 })}`;
}
