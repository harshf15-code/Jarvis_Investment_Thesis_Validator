"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { computeDistanceToStop, computePositionPnl } from "@/lib/position-metrics";
import { formatCurrency, formatExchangeTime } from "@/lib/format";
import { currencyForExchange } from "@/lib/markets";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import { CoinGeckoAttribution } from "@/components/shared/coingecko-attribution";
import type { AssetClass, ConvictionTier, ExchangeCode, ThesisSource } from "@/lib/types";

export type PositionRow = {
  position: { id: string; ticker: string; status: string; portfolio_id: string };
  // `last_price_at` is what the Cockpit's <LastUpdated/> stamps (spec Section
  // 5: every screen showing a price says when it was taken). This table reads
  // it for CRYPTO rows only — see the price cell.
  stock:
    | {
        last_price: number | null;
        last_price_at?: string | null;
        exchange: ExchangeCode;
        currency: string;
        /** Optional because the recommendation rail's lighter `stocks` select
         *  does not ask for it. Absent means equity, which is what it was
         *  before 0030. */
        asset_class?: AssetClass;
      }
    | undefined;
  tradePlan: {
    stop_loss: number | null;
    target_1: number | null;
    target_2: number | null;
    time_exit_date: string | null;
  } | undefined;
  weightedAverage: { totalQuantity: number; averagePrice: number };
  convictionTier?: ConvictionTier;
  /** `imported` when this position came from a CSV rather than a memorandum
   *  (0020) — which is why its stop, targets and time exit are all empty. */
  source?: ThesisSource;
};

type SortKey = "distanceToStop" | "returnPct" | "thesisDate";

export function PositionsTable({
  rows,
  books,
}: {
  rows: PositionRow[];
  /** Book id → book, passed only in the ROLL-UP, where rows come from several.
   *  Two books can hold the same ticker, and without this the two rows are
   *  identical text — so "trim the one in my own account" is a coin flip. */
  books?: Map<string, { name: string; ownership: string }>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("distanceToStop");

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const priceA = a.stock?.last_price ?? 0;
      const priceB = b.stock?.last_price ?? 0;
      if (sortKey === "distanceToStop") {
        const distA = computeDistanceToStop({ currentPrice: priceA, stopLoss: a.tradePlan?.stop_loss ?? null });
        const distB = computeDistanceToStop({ currentPrice: priceB, stopLoss: b.tradePlan?.stop_loss ?? null });
        return (distA?.percent ?? Infinity) - (distB?.percent ?? Infinity);
      }
      if (sortKey === "returnPct") {
        const pnlA = computePositionPnl({ currentPrice: priceA, avgEntry: a.weightedAverage.averagePrice, quantity: 1 });
        const pnlB = computePositionPnl({ currentPrice: priceB, avgEntry: b.weightedAverage.averagePrice, quantity: 1 });
        return pnlB.percent - pnlA.percent;
      }
      const dateA = a.tradePlan?.time_exit_date ?? "9999-99-99";
      const dateB = b.tradePlan?.time_exit_date ?? "9999-99-99";
      return dateA.localeCompare(dateB);
    });
  }, [rows, sortKey]);

  return (
    <div className="overflow-x-auto rounded-xl bg-surface-container-low">
      <div className="flex gap-2 rounded-t-xl bg-surface-container-high p-3 text-xs text-on-surface/50">
        <span>Sort by:</span>
        {(["distanceToStop", "returnPct", "thesisDate"] as SortKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setSortKey(key)}
            className={sortKey === key ? "text-primary" : "hover:text-on-surface"}
          >
            {key === "distanceToStop" ? "Distance to Stop" : key === "returnPct" ? "Return %" : "Thesis Date"}
          </button>
        ))}
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-on-surface/50">
            <th className="p-3">Ticker</th>
            <th className="p-3">Avg Entry</th>
            <th className="p-3">CMP</th>
            <th className="p-3">Return</th>
            <th className="p-3">Dist. to Stop</th>
            <th className="p-3">T1</th>
            <th className="p-3">T2</th>
            <th className="p-3">Tier</th>
            <th className="p-3">Time Exit</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const price = row.stock?.last_price ?? null;
            // Exchange-aware, not a flat "USD": a row missing its currency is
            // still on a known exchange, and labelling an NSE holding in
            // dollars is the exact defect this column was added to remove.
            const currency = row.stock?.currency ?? currencyForExchange(row.stock?.exchange ?? "US");
            const pnl = price !== null
              ? computePositionPnl({ currentPrice: price, avgEntry: row.weightedAverage.averagePrice, quantity: row.weightedAverage.totalQuantity })
              : null;
            const dist = price !== null
              ? computeDistanceToStop({ currentPrice: price, stopLoss: row.tradePlan?.stop_loss ?? null })
              : null;
            const t1Hit = price !== null && row.tradePlan?.target_1 != null && price >= row.tradePlan.target_1;
            const t2Hit = price !== null && row.tradePlan?.target_2 != null && price >= row.tradePlan.target_2;

            return (
              <tr key={row.position.id} className="even:bg-surface-container-lowest hover:bg-surface-container-high">
                <td className="p-3">
                  <Link href={`/positions/${row.position.id}`} className="font-medium text-on-surface hover:text-primary">
                    {row.position.ticker}
                  </Link>
                  {books && (
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 align-middle font-mono text-[9px] tracking-wider uppercase ${
                        books.get(row.position.portfolio_id)?.ownership === "managed"
                          ? "bg-status-amber-container text-status-amber"
                          : "bg-surface-container-highest text-on-surface/50"
                      }`}
                    >
                      {books.get(row.position.portfolio_id)?.name ?? "Unknown book"}
                    </span>
                  )}
                  {row.source === "imported" && (
                    <span
                      title="Imported from a CSV — no Jarvis trade plan behind it, so it has no stop or targets yet."
                      className="ml-2 rounded-full bg-surface-container-highest px-1.5 py-0.5 align-middle font-mono text-[9px] tracking-wider text-on-surface/50 uppercase"
                    >
                      Imported
                    </span>
                  )}
                </td>
                <td className="p-3 font-mono tabular-nums">{formatCurrency(row.weightedAverage.averagePrice, currency)}</td>
                <td className="p-3 font-mono tabular-nums">
                  {price !== null ? formatCurrency(price, currency) : "Price unavailable"}
                  {/* Per-row, and only for a coin. A coin's price is polled
                      hourly every day; the equity rows beside it are not polled
                      outside a session, so neither one's freshness describes
                      the other. The screen-level stamp cannot say this without
                      claiming a single age for prices that do not share one. */}
                  {row.stock?.asset_class === "crypto" && row.stock?.last_price_at && (
                    <span className="block font-sans text-[10px] text-on-surface/35">
                      as of {formatExchangeTime(new Date(row.stock.last_price_at), "CRYPTO")}
                    </span>
                  )}
                </td>
                <td className={`p-3 font-mono tabular-nums ${pnl && pnl.percent >= 0 ? "text-status-green" : "text-status-red"}`}>
                  {pnl ? `${pnl.percent >= 0 ? "+" : ""}${pnl.percent.toFixed(2)}%` : "—"}
                </td>
                <td className={`p-3 font-mono tabular-nums ${dist && dist.absolute <= 0 ? "text-status-red" : ""}`}>
                  {dist ? formatCurrency(dist.absolute, currency) : "—"}
                </td>
                <td className="p-3">{t1Hit ? <span className="text-status-green">HIT</span> : "—"}</td>
                <td className="p-3">{t2Hit ? <span className="text-status-green">HIT</span> : "—"}</td>
                <td className="p-3">{row.convictionTier && <ConvictionBadge tier={row.convictionTier} />}</td>
                <td className="p-3 text-on-surface/70">{row.tradePlan?.time_exit_date ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Directly under the data set, per CoinGecko's attribution guide, and
          only when a coin is actually in it. */}
      <CoinGeckoAttribution
        show={rows.some((r) => r.stock?.asset_class === "crypto")}
        className="px-3 pb-3"
      />
    </div>
  );
}
