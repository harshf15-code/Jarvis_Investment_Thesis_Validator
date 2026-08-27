import { formatCurrency } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/**
 * Screen HUB-1's three headline numbers (US-01).
 *
 * "Total Open P&L" is unrealized P&L since entry across every open position —
 * not a "today" figure. The v2 schema stores no time series of portfolio
 * value, so a day/week/MTD delta isn't computable; this labels what it
 * actually shows rather than passing a since-entry number off as a daily one.
 *
 * `exchange` is null when the open positions span more than one currency (or
 * when there are none): summing INR and USD into one figure has no single
 * currency symbol to wear, so the total is rendered bare and labelled as
 * mixed instead of being stamped with a symbol that would be wrong for half
 * the book.
 */
export function PortfolioSummary({
  totalOpenPnl,
  exchange,
  positionCount,
  pendingRecCount,
}: {
  totalOpenPnl: { absolute: number; percent: number };
  exchange: ExchangeCode | null;
  positionCount: number;
  pendingRecCount: number;
}) {
  const gain = totalOpenPnl.absolute >= 0;
  const sign = gain ? "+" : "";
  const absolute = exchange
    ? formatCurrency(totalOpenPnl.absolute, exchange)
    : totalOpenPnl.absolute.toFixed(2);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="font-display text-xs uppercase text-on-surface/50">
          Total Open P&L{exchange === null && positionCount > 0 ? " (mixed currencies)" : ""}
        </p>
        <p className={`mt-1 font-mono text-xl tabular-nums ${gain ? "text-status-green" : "text-status-red"}`}>
          {sign}
          {absolute} ({sign}
          {totalOpenPnl.percent.toFixed(2)}%)
        </p>
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
