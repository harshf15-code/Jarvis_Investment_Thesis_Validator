import Link from "next/link";

import { isNearStop } from "@/lib/position-metrics";
import type { PositionRow } from "@/components/positions/positions-table";

/**
 * Screen HUB-1's list-level alert rail (US-01): a RED pill per position
 * trading within 3% of its stop, and an AMBER chip per position whose
 * thesis-test date has already passed. Deliberately separate from
 * `<DisciplineBanner/>`, which is the single-position, blocking treatment on
 * the position-detail screen — this one is a scannable summary across the
 * whole book and never blocks anything.
 */
export function AlertRail({
  positions,
  overdueTickers,
}: {
  positions: PositionRow[];
  overdueTickers: string[];
}) {
  const nearStop = positions.filter((row) =>
    isNearStop({ currentPrice: row.stock?.last_price, stopLoss: row.tradePlan?.stop_loss }),
  );

  if (nearStop.length === 0 && overdueTickers.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {nearStop.map((row) => (
        <Link
          key={row.position.id}
          href={`/positions/${row.position.id}`}
          className="rounded-full bg-status-red-container px-3 py-1 text-xs font-medium text-status-red transition-opacity hover:opacity-80"
        >
          {row.position.ticker} near stop
        </Link>
      ))}
      {overdueTickers.map((ticker) => (
        <span
          key={ticker}
          className="rounded-full bg-primary-container px-3 py-1 text-xs font-medium text-primary"
        >
          ⏱ Thesis Test Overdue — {ticker}
        </span>
      ))}
    </div>
  );
}
