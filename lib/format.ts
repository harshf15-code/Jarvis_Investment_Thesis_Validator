/**
 * Currency and exchange-timezone formatting, shared by every screen that
 * renders a stock's price or stamps a time against one.
 *
 * Pulled out of `components/dashboard/stock-card.tsx` and
 * `app/(app)/stocks/[id]/page.tsx` (Task 12 polish pass) — both had the
 * identical `Intl.NumberFormat` logic duplicated verbatim.
 */

import { localeForCurrency } from "@/lib/markets";
import type { ExchangeCode } from "@/lib/types";

/**
 * Renders an amount in the currency the stock actually trades in.
 *
 * Takes a currency, not an exchange. It used to take an exchange and read
 * `exchange === "US" ? USD : INR`, which was a binary that labelled every
 * non-US listing as rupees — correct only for as long as the universe stayed
 * NSE/BSE/US, and wrong the moment it does not. `stocks.currency` (0021) is
 * the source now, and it comes off the quote itself.
 */
export function formatCurrency(value: number, currency: string): string {
  // `GBp` is Yahoo's code for PENCE, and it is a real value in `stocks`
  // (0021's constraint allows it deliberately). `Intl` canonicalises the code
  // case-insensitively to GBP, so 430.5 pence would render as £430.50 —
  // a hundredfold overstatement, on a number sitting next to a P&L figure.
  // Pence has no `Intl` currency of its own, so it is rendered the way the LSE
  // quotes it.
  if (currency.toLowerCase() === "gbp" && currency !== "GBP") {
    return `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}p`;
  }
  return new Intl.NumberFormat(localeForCurrency(currency), {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * IANA timezone for a stock's exchange, matching `lib/market-hours.ts`'s
 * `MARKET_SESSIONS` mapping (NSE -> Asia/Kolkata, US -> America/New_York).
 * BSE shares NSE's timezone — both are Indian exchanges — so it isn't its
 * own entry in `MARKET_SESSIONS` (keyed by `"NSE" | "US"` there) but needs
 * to resolve the same way here, since `ExchangeCode` is `"NSE" | "BSE" |
 * "US"`.
 *
 * Used by server-rendered components that stamp a price/alert timestamp:
 * without an explicit `timeZone`, `toLocaleString` renders in the *server's*
 * timezone (UTC on Vercel), not anything timezone-meaningful to the user.
 */
export function exchangeTimeZone(exchange: ExchangeCode): string {
  // CRYPTO has no exchange and no session, so there is no "its own timezone"
  // to render it in. It falls to the app's default deliberately rather than by
  // accident: UTC would be the more literal answer for a global asset, but it
  // would put one clock on this screen that matches no other timestamp the
  // trader reads, which is a worse way to be right.
  return exchange === "US" ? "America/New_York" : "Asia/Kolkata";
}

/**
 * Formats a timestamp in its stock's exchange timezone. `options` can
 * override the default `month`/`day`/`hour`/`minute` fields (e.g. to add
 * `year`), but `timeZone` is always derived from `exchange` and applied
 * last, so a caller can't accidentally revert to the host's local timezone.
 */
export function formatExchangeTime(
  date: Date,
  exchange: ExchangeCode,
  options?: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
    timeZone: exchangeTimeZone(exchange),
  });
}
