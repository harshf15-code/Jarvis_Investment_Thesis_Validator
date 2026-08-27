"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { computeRiskReward, computeMaxDrawdownPct, computeCashAtRisk } from "@/lib/risk-reward";
import { PriceBadge } from "@/components/shared/price-badge";
import { formatCurrency } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

type GridState = {
  entry_zone_low: string;
  entry_zone_high: string;
  add_tranche_low: string;
  add_tranche_high: string;
  stop_loss: string;
  target_1: string;
  target_2: string;
  position_size_pct: string;
  time_exit_date: string;
  time_exit_condition: string;
};

const EMPTY_GRID: GridState = {
  entry_zone_low: "",
  entry_zone_high: "",
  add_tranche_low: "",
  add_tranche_high: "",
  stop_loss: "",
  target_1: "",
  target_2: "",
  position_size_pct: "",
  time_exit_date: "",
  time_exit_condition: "",
};

const FIELDS: { key: keyof GridState; label: string; type: "number" | "date" }[] = [
  { key: "entry_zone_low", label: "Entry Zone Low", type: "number" },
  { key: "entry_zone_high", label: "Entry Zone High", type: "number" },
  { key: "add_tranche_low", label: "Add Tranche Low", type: "number" },
  { key: "add_tranche_high", label: "Add Tranche High", type: "number" },
  { key: "stop_loss", label: "Stop Loss *", type: "number" },
  { key: "target_1", label: "Target 1", type: "number" },
  { key: "target_2", label: "Target 2", type: "number" },
  { key: "position_size_pct", label: "Position Size %", type: "number" },
  { key: "time_exit_date", label: "Time Exit Date", type: "date" },
];

/** `""` -> null so an untouched cell is sent as SQL NULL, never as `0`. */
function num(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Spec Screen 2-3 Step 3 (US-12): 9-cell grid. CMP is read-only/fetched, not part of the editable grid state. */
export function TradePlanGrid({
  thesisId,
  cmp,
  exchange,
  portfolioValue = 1_000_000,
}: {
  thesisId: string;
  cmp: number | null;
  exchange: ExchangeCode;
  portfolioValue?: number;
}) {
  const router = useRouter();
  const [grid, setGrid] = useState<GridState>(EMPTY_GRID);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const entry = num(grid.entry_zone_low) ?? cmp;
    const stop = num(grid.stop_loss);
    const target = num(grid.target_1);
    if (entry === null || stop === null) return null;
    return {
      riskReward: target !== null ? computeRiskReward({ entry, stop, target }) : null,
      maxDrawdownPct: computeMaxDrawdownPct({ entry, stop }),
      cashAtRisk: computeCashAtRisk({
        portfolioValue,
        positionSizePct: num(grid.position_size_pct) ?? 0,
        entry,
        stop,
      }),
    };
  }, [grid, cmp, portfolioValue]);

  const canLock = num(grid.stop_loss) !== null;

  function set(field: keyof GridState, value: string) {
    setGrid((prev) => ({ ...prev, [field]: value }));
  }

  async function handleLock() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/trade-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thesis_id: thesisId,
          entry_zone_low: num(grid.entry_zone_low),
          entry_zone_high: num(grid.entry_zone_high),
          add_tranche_low: num(grid.add_tranche_low),
          add_tranche_high: num(grid.add_tranche_high),
          stop_loss: num(grid.stop_loss),
          target_1: num(grid.target_1),
          target_2: num(grid.target_2),
          position_size_pct: num(grid.position_size_pct),
          time_exit_date: grid.time_exit_date || null,
          time_exit_condition: grid.time_exit_condition || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to lock plan");
      router.push(`/thesis/${thesisId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-xs uppercase tracking-wide text-on-surface/50">Step 3 of 3</p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-on-surface/50">CMP:</span>
        <PriceBadge price={cmp} exchange={exchange} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FIELDS.map(({ key, label, type }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs text-on-surface/50">{label}</span>
            <input
              type={type}
              value={grid[key]}
              onChange={(e) => set(key, e.target.value)}
              className="rounded-lg bg-surface-container-highest px-3 py-2 font-mono text-sm text-on-surface"
            />
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-on-surface/50">Time Exit Condition</span>
        <input
          type="text"
          placeholder='e.g. "Chetak share < 15%"'
          value={grid.time_exit_condition}
          onChange={(e) => set("time_exit_condition", e.target.value)}
          className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface/40"
        />
      </label>

      {metrics && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Risk/Reward</p>
            <p className="font-mono text-lg text-on-surface">
              {metrics.riskReward !== null ? `${metrics.riskReward.toFixed(2)}:1` : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Max Drawdown</p>
            <p className="font-mono text-lg text-on-surface">{metrics.maxDrawdownPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Cash at Risk</p>
            <p className="font-mono text-lg text-on-surface">
              {formatCurrency(metrics.cashAtRisk, exchange)}
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-status-red">{error}</p>}

      <button
        type="button"
        onClick={handleLock}
        disabled={!canLock || submitting}
        className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Lock &amp; Save Plan
      </button>
    </div>
  );
}
