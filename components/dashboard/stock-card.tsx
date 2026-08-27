import Link from "next/link";

import { PulseChip } from "@/components/layout/pulse-chip";
import { StatusChip } from "@/components/dashboard/status-chip";
import { formatCurrency, formatExchangeTime } from "@/lib/format";
import { computeUnrealizedPnl } from "@/lib/pnl";
import { cn } from "@/lib/utils";
import type { ExchangeCode, Holding, Stock } from "@/lib/types";

/**
 * A `stocks` row joined with its `holdings` row, matching the shape
 * `GET /api/stocks` returns (`app/api/stocks/route.ts`) — `holding` is
 * `null` for a watchlist-only entry.
 */
export type StockWithHolding = Stock & { holding: Holding | null };

/**
 * Not "use client": this card only needs `next/link` navigation and CSS
 * `:hover`/`group-hover`, neither of which requires client-side JS state, so
 * it stays a plain server-renderable component. The P&L math itself lives in
 * `lib/pnl.ts` as a pure function, called directly during render here.
 */

function formatAsOf(iso: string | null, exchange: ExchangeCode): string {
  if (iso === null) {
    return "No price yet";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "No price yet";
  }
  return `as of ${formatExchangeTime(date, exchange)}`;
}

export function StockCard({ stock }: { stock: StockWithHolding }) {
  const { holding, last_price: lastPrice } = stock;
  const pnl =
    holding !== null && lastPrice !== null
      ? computeUnrealizedPnl(lastPrice, holding.shares, holding.cost_basis)
      : null;
  const isGain = pnl !== null && pnl.absolute >= 0;

  return (
    <Link
      href={`/stocks/${stock.id}`}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-xl bg-surface-container-low p-5 transition-colors hover:bg-surface-container-high"
    >
      {/*
        Design system's hover accent: a 0.25rem (w-1) primary-colored left
        bar, only visible on hover — reserved as transparent at rest so it
        never causes layout shift.
      */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-primary opacity-0 transition-opacity group-hover:opacity-100"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-display text-lg font-semibold text-on-surface">
            {stock.ticker}
          </span>
          <span className="text-xs text-on-surface/60">{stock.exchange}</span>
        </div>
        <StatusChip status={stock.status} />
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-2xl font-semibold text-on-surface">
          {lastPrice !== null ? formatCurrency(lastPrice, stock.exchange) : "—"}
        </span>
        <span className="text-xs text-on-surface/50">
          {formatAsOf(stock.last_price_at, stock.exchange)}
        </span>
      </div>

      {holding !== null ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <PulseChip />
          <span className="text-on-surface/70">
            {holding.shares} sh @ {formatCurrency(holding.cost_basis, stock.exchange)}
          </span>
          {pnl !== null ? (
            <span
              className={cn(
                "font-medium",
                isGain ? "text-primary" : "text-error",
              )}
            >
              {isGain ? "+" : ""}
              {formatCurrency(pnl.absolute, stock.exchange)}
              {pnl.percent !== null ? (
                <span className="ml-1 text-xs opacity-80">
                  ({isGain ? "+" : ""}
                  {pnl.percent.toFixed(2)}%)
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
