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
 * `live: false` markets are deliberately visible but unselectable. `stocks`
 * now carries a currency (0021), so a ¥6,052 quote would at least be LABELLED
 * as yuan — but labelling is not listing. What still does not exist is any way
 * to resolve one of these names in the first place: `exchange_code` is
 * `NSE|BSE|US` and has no value for SSE, LSE or XETRA, `exchangesFor` returns
 * an empty list for all three, `resolveYahooSymbol` has no suffix to build,
 * and `lib/market-hours.ts` knows only NSE and US sessions. Each of those is
 * real work with real per-exchange testing behind it, so these stay off rather
 * than shipping half-priced reports.
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
 * Locale to render a currency in, derived from `MARKETS` rather than kept as a
 * second hand-maintained table — the currency and the locale that groups its
 * digits correctly are already paired there. First market in `MARKET_ORDER`
 * wins, which matters only for USD (claimed by US, also EM's currency) where
 * both entries name `en-US` anyway.
 *
 * `en-US` is the fallback for a currency no market claims. That is not a
 * guess about the money — `Intl.NumberFormat` still renders the right symbol
 * and the right minor units from the currency code — only about digit
 * grouping, which is the one part a fallback can be wrong about harmlessly.
 */
const CURRENCY_LOCALE: Record<string, string> = Object.fromEntries(
  MARKET_ORDER.map((code) => [MARKETS[code].currency, MARKETS[code].locale] as const).reverse(),
);

export function localeForCurrency(currency: string): string {
  return CURRENCY_LOCALE[currency.toUpperCase()] ?? "en-US";
}

/**
 * The currency a market's listings quote in. Used as the fallback when a Yahoo
 * quote comes back without one, and as the expectation a resolved listing is
 * checked against — a symbol that prices in dollars for an India run resolved
 * to an ADR, not to the NSE line the trader meant.
 */
export function currencyForMarket(market: MarketCode): string {
  return MARKETS[market].currency;
}

/**
 * The bare symbol for a currency (`₹`, `$`). For the handful of places that
 * prefix an already-formatted string rather than formatting a number —
 * `formatCurrency` is the right tool everywhere a raw number is being
 * rendered.
 */
export function symbolForCurrency(currency: string): string {
  const upper = currency.toUpperCase();
  const market = MARKET_ORDER.find((code) => MARKETS[code].currency === upper);
  return market ? MARKETS[market].symbol : `${upper} `;
}

/**
 * The currency an exchange's listings quote in. The fallback whenever a Yahoo
 * quote arrives without a currency of its own — a thesis run can span markets,
 * so the exchange that actually resolved is the honest source, not whichever
 * market the trader happened to list first.
 */
export function currencyForExchange(exchange: ExchangeCode): string {
  return currencyForMarket(marketForExchange(exchange));
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
