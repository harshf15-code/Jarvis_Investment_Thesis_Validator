/**
 * Currency formatting shared by every screen that renders a stock's price in
 * its native exchange currency (US -> USD, NSE/BSE -> INR).
 *
 * Pulled out of `components/dashboard/stock-card.tsx` and
 * `app/(app)/stocks/[id]/page.tsx` (Task 12 polish pass) — both had the
 * identical `Intl.NumberFormat` logic duplicated verbatim.
 */

import type { Stock } from "@/lib/types";

export function formatCurrency(
  value: number,
  exchange: Stock["exchange"],
): string {
  const isUS = exchange === "US";
  return new Intl.NumberFormat(isUS ? "en-US" : "en-IN", {
    style: "currency",
    currency: isUS ? "USD" : "INR",
    maximumFractionDigits: 2,
  }).format(value);
}
