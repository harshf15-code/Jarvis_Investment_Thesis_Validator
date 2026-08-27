"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { computeDistanceToStop, computePositionPnl } from "@/lib/position-metrics";
import { formatCurrency } from "@/lib/format";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import type { ConvictionTier, ExchangeCode } from "@/lib/types";

export type PositionRow = {
  position: { id: string; ticker: string; status: string };
  stock: { last_price: number | null; exchange: ExchangeCode } | undefined;
  tradePlan: {
    stop_loss: number | null;
    target_1: number | null;
    target_2: number | null;
    time_exit_date: string | null;
  } | undefined;
  weightedAverage: { totalQuantity: number; averagePrice: number };
  convictionTier?: ConvictionTier;
};

type SortKey = "distanceToStop" | "returnPct" | "thesisDate";

export function PositionsTable({ rows }: { rows: PositionRow[] }) {
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
            const exchange = row.stock?.exchange ?? "US";
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
                </td>
                <td className="p-3 font-mono tabular-nums">{formatCurrency(row.weightedAverage.averagePrice, exchange)}</td>
                <td className="p-3 font-mono tabular-nums">{price !== null ? formatCurrency(price, exchange) : "Price unavailable"}</td>
                <td className={`p-3 font-mono tabular-nums ${pnl && pnl.percent >= 0 ? "text-status-green" : "text-status-red"}`}>
                  {pnl ? `${pnl.percent >= 0 ? "+" : ""}${pnl.percent.toFixed(2)}%` : "—"}
                </td>
                <td className={`p-3 font-mono tabular-nums ${dist && dist.rupees <= 0 ? "text-status-red" : ""}`}>
                  {dist ? formatCurrency(dist.rupees, exchange) : "—"}
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
    </div>
  );
}
