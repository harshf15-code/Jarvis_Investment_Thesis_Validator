"use client";

import { useMemo, useState } from "react";
import { computeRecommendationStatus } from "@/lib/recommendation-status";
import type { ConvictionTier } from "@/lib/types";

type Row = {
  recommendation: {
    conviction_tier: ConvictionTier;
    recommended_stop: number | null;
    recommended_target_1: number | null;
    recommended_target_2: number | null;
    price_at_recommendation: number;
    converted_to_position: boolean;
  };
  stock: { last_price: number | null } | undefined;
};

/**
 * US-02's cockpit widget and US-23's full stats strip share this exact
 * "unacted-on only" filter (spec: "to avoid double-counting" positions that
 * already have their own real P&L tracked elsewhere) — this component is
 * reused directly by Task 24's Cockpit summary widget, not reimplemented.
 */
export function RecommendationStats({ rows }: { rows: Row[] }) {
  const [hypothetical, setHypothetical] = useState(false);

  const stats = useMemo(() => {
    const unacted = rows.filter((r) => !r.recommendation.converted_to_position);
    const byTier: Record<ConvictionTier, { wins: number; losses: number; open: number }> = {
      I: { wins: 0, losses: 0, open: 0 },
      II: { wins: 0, losses: 0, open: 0 },
      III: { wins: 0, losses: 0, open: 0 },
      IV: { wins: 0, losses: 0, open: 0 },
    };
    let wins = 0, losses = 0, openCount = 0, hypotheticalPnl = 0;

    for (const row of unacted) {
      const price = row.stock?.last_price;
      if (price == null) continue;
      const status = computeRecommendationStatus(row.recommendation, price);
      const tier = byTier[row.recommendation.conviction_tier];
      if (status === "stop_hit") {
        losses++; tier.losses++;
      } else if (status === "t1_hit" || status === "t2_hit") {
        wins++; tier.wins++;
      } else {
        openCount++; tier.open++;
      }
      hypotheticalPnl += price - row.recommendation.price_at_recommendation;
    }

    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;
    return { total: unacted.length, wins, losses, open: openCount, winRate, byTier, hypotheticalPnl };
  }, [rows]);

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Total Recs", stats.total],
          ["Wins (T1 before stop)", stats.wins],
          ["Losses (stop before T1)", stats.losses],
          ["Still Open", stats.open],
          ["Win Rate", stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-surface-container-low p-4">
            <p className="font-display text-xs uppercase text-on-surface/50">{label}</p>
            <p className="mt-1 font-mono text-lg text-on-surface">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-on-surface/60">
        {(["I", "II", "III"] as ConvictionTier[]).map((tier) => {
          const t = stats.byTier[tier];
          const rate = t.wins + t.losses > 0 ? ((t.wins / (t.wins + t.losses)) * 100).toFixed(0) : "—";
          return <span key={tier}>Tier {tier}: {rate}%</span>;
        })}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={hypothetical} onChange={(e) => setHypothetical(e.target.checked)} />
          Hypothetical P&L
        </label>
        {hypothetical && (
          <span className={stats.hypotheticalPnl >= 0 ? "text-status-green" : "text-status-red"}>
            {stats.hypotheticalPnl >= 0 ? "+" : ""}
            {stats.hypotheticalPnl.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
