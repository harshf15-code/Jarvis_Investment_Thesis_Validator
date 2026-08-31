import { formatCurrency } from "@/lib/format";

/**
 * Screen HUB-1's three headline numbers (US-01).
 *
 * "Total Open P&L" is unrealized P&L since entry across every open position —
 * not a "today" figure. The v2 schema stores no time series of portfolio
 * value, so a day/week/MTD delta isn't computable; this labels what it
 * actually shows rather than passing a since-entry number off as a daily one.
 *
 * It is also one line PER CURRENCY, because there is no exchange rate in this
 * app and inventing one is worse than showing two numbers. This used to render
 * a single blended figure — with the symbol dropped and the words "(mixed
 * currencies)" appended when the book spanned exchanges, which was an honest
 * label on a number that was still just rupees added to dollars. Each line
 * here is correct on its own terms.
 */
export type CurrencyTotal = {
  currency: string;
  absolute: number;
  percent: number;
  positions: number;
};

export function PortfolioSummary({
  totalsByCurrency,
  positionCount,
  pendingRecCount,
}: {
  totalsByCurrency: CurrencyTotal[];
  positionCount: number;
  pendingRecCount: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="font-display text-xs uppercase text-on-surface/50">Total Open P&L</p>
        {totalsByCurrency.length === 0 ? (
          <p className="mt-1 font-mono text-xl tabular-nums text-on-surface/40">—</p>
        ) : (
          <div className="mt-1 flex flex-col gap-0.5">
            {totalsByCurrency.map((total) => {
              const sign = total.absolute >= 0 ? "+" : "";
              return (
                <p
                  key={total.currency}
                  className={`font-mono text-xl tabular-nums ${total.absolute >= 0 ? "text-status-green" : "text-status-red"}`}
                >
                  {sign}
                  {formatCurrency(total.absolute, total.currency)} ({sign}
                  {total.percent.toFixed(2)}%)
                  {/* Only worth naming the sub-book once there is more than one. */}
                  {totalsByCurrency.length > 1 && (
                    <span className="ml-2 font-sans text-[11px] text-on-surface/40">
                      {total.positions} {total.positions === 1 ? "position" : "positions"}
                    </span>
                  )}
                </p>
              );
            })}
          </div>
        )}
      </div>
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="font-display text-xs uppercase text-on-surface/50">Active Positions</p>
        <p className="mt-1 font-mono text-xl tabular-nums text-on-surface">{positionCount}</p>
      </div>
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="font-display text-xs uppercase text-on-surface/50">Pending Recommendations</p>
        <p className="mt-1 font-mono text-xl tabular-nums text-on-surface">{pendingRecCount}</p>
      </div>
    </div>
  );
}
