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
  /**
   * Can this market ever be the SUBJECT of a thesis?
   *
   * True for every equity market, including the ones that are not live yet —
   * CN/EU/EM are "coming soon" on the thesis picker, not excluded from it.
   * False only for crypto, which is holdings-only by design: there is no
   * shortlist to build and no memorandum to write, so it is not coming soon
   * either, and showing it greyed out would promise something untrue.
   *
   * Orthogonal to `live`, which governs whether holdings can be priced and
   * imported. Crypto is live and not tradable; CN is tradable and not live.
   */
  tradable: boolean;
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
    tradable: true,
    exchanges: ["US"],
    currency: "USD",
    symbol: "$",
    locale: "en-US",
  },
  IN: {
    label: "India",
    live: true,
    tradable: true,
    exchanges: ["NSE", "BSE"],
    currency: "INR",
    symbol: "₹",
    locale: "en-IN",
  },
  CN: { label: "China", live: false, tradable: true, exchanges: [], currency: "CNY", symbol: "¥", locale: "zh-CN" },
  EU: { label: "Europe", live: false, tradable: true, exchanges: [], currency: "EUR", symbol: "€", locale: "en-GB" },
  EM: {
    label: "Emerging Markets",
    live: false,
    tradable: true,
    exchanges: [],
    currency: "USD",
    symbol: "$",
    locale: "en-US",
  },
  CRYPTO: {
    label: "Crypto",
    live: true,
    tradable: false,
    // A coin is not listed on an exchange. `stocks.exchange` gets the sentinel
    // 'CRYPTO' so the NOT NULL column has an honest value, but nothing resolves
    // an exchange for a coin the way `exchangesFor` does for an equity.
    exchanges: [],
    // INERT, AND MUST NOT BE READ FOR A CRYPTO ROW. Every other market has one
    // fixed currency; crypto's comes from the portfolio's `base_currency`, and
    // the currency of record is `stocks.currency`, which is what the positions
    // table already prefers. These three exist because `MarketMeta` requires
    // them, not because they mean anything here.
    currency: "USD",
    symbol: "$",
    locale: "en-US",
  },
};

/** Display order for the selector — live markets first, then the rest. */
export const MARKET_ORDER: MarketCode[] = ["US", "IN", "CRYPTO", "CN", "EU", "EM"];

export const LIVE_MARKETS: MarketCode[] = MARKET_ORDER.filter((m) => MARKETS[m].live);

/**
 * The markets a THESIS may be about — every live market except crypto.
 *
 * Separate from `LIVE_MARKETS` because "can I hold this" and "can Jarvis write
 * a memorandum about this" stopped being the same question when crypto
 * arrived. Holdings-only is what crypto is in v1.
 */
export const THESIS_MARKETS: MarketCode[] = MARKET_ORDER.filter(
  (m) => MARKETS[m].live && MARKETS[m].tradable,
);

/**
 * What the thesis market picker RENDERS — every thesis-capable market, live or
 * not, so CN/EU/EM keep their honest "coming soon" state. Crypto is absent
 * rather than disabled: it is not coming soon, and greying it out would
 * promise a feature that is not planned.
 */
export const THESIS_MARKET_CHOICES: MarketCode[] = MARKET_ORDER.filter(
  (m) => MARKETS[m].tradable,
);

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
