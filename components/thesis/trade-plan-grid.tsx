"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";

import { computeRiskReward, computeMaxDrawdownPct, computeCashAtRisk } from "@/lib/risk-reward";
import { PriceBadge } from "@/components/shared/price-badge";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
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

type NumericKey = Exclude<keyof GridState, "time_exit_date" | "time_exit_condition">;

/** Shape of `POST /api/theses/:id/trade-plan-draft`'s `draft`. */
type TradePlanDraft = Partial<Record<NumericKey, number | null>> & {
  time_exit_date?: string | null;
  time_exit_condition?: string | null;
  notes?: string | null;
};

const FIELDS: { key: keyof GridState; label: string; type: "number" | "date"; tone?: "error" }[] = [
  { key: "entry_zone_low", label: "Entry Zone Low", type: "number" },
  { key: "entry_zone_high", label: "Entry Zone High", type: "number" },
  { key: "add_tranche_low", label: "Add Tranche Low", type: "number" },
  { key: "add_tranche_high", label: "Add Tranche High", type: "number" },
  { key: "stop_loss", label: "Stop Loss *", type: "number", tone: "error" },
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

function draftToGrid(draft: TradePlanDraft): GridState {
  const next: GridState = { ...EMPTY_GRID };
  for (const { key } of FIELDS) {
    if (key === "time_exit_date") continue;
    const value = draft[key as NumericKey];
    if (value != null) next[key] = String(value);
  }
  next.time_exit_date = draft.time_exit_date ?? "";
  next.time_exit_condition = draft.time_exit_condition ?? "";
  return next;
}

/**
 * Spec Screen 2-3 Step 3 (US-12): 9-cell grid. CMP is read-only/fetched, not
 * part of the editable grid state.
 *
 * The grid opens PRE-FILLED by Jarvis (`POST /api/theses/:id/trade-plan-draft`)
 * — US-12's "Grid is pre-filled by Claude API based on the thesis". It shipped
 * without that, so every cell opened blank and the trader had to derive entries,
 * stops and targets by hand, which is the work the wizard exists to do.
 */
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
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<string | null>(null);
  // Retained so `POST /api/trade-plans` can record what Jarvis proposed
  // independently of what the trader typed over it (the Reset affordance on the
  // review screen diffs against this).
  const [aiSuggested, setAiSuggested] = useState<TradePlanDraft | null>(null);
  const [touched, setTouched] = useState<Set<keyof GridState>>(new Set());

  const generate = useCallback(async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}/trade-plan-draft`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Jarvis couldn't draft this plan.");
      const draft: TradePlanDraft = body.draft ?? {};
      setAiSuggested(draft);
      setDraftNotes(draft.notes ?? null);
      // Never clobber a cell the trader has already typed into.
      setGrid((prev) => {
        const filled = draftToGrid(draft);
        const next = { ...filled };
        for (const key of touched) next[key] = prev[key];
        return next;
      });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDrafting(false);
    }
  }, [thesisId, touched]);

  // Draft once on arrival. `useRef` rather than a `[]` dep list because
  // `generate` legitimately changes identity as `touched` grows, and React
  // StrictMode double-invokes effects in dev — either would bill a second
  // model call for the same visit.
  const hasDrafted = useRef(false);
  useEffect(() => {
    if (hasDrafted.current) return;
    hasDrafted.current = true;
    void generate();
  }, [generate]);

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
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
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
          ai_suggested: aiSuggested ?? undefined,
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
            Step 3 of 3 · Trade Plan
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
            CMP
          </span>
          <PriceBadge price={cmp} exchange={exchange} />
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={drafting}
          className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3", drafting && "animate-spin")} strokeWidth={2.5} />
          {drafting ? "Drafting" : "Re-draft"}
        </button>
      </div>

      {drafting && (
        <p className="flex items-center gap-2 text-xs text-primary">
          <Sparkles className="size-3.5" strokeWidth={2.5} />
          Jarvis is sizing entries, stops and targets against CMP…
        </p>
      )}

      {draftError && (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
          {draftError} You can still fill the grid in yourself.{" "}
          <button type="button" onClick={generate} className="underline">
            Retry
          </button>
        </div>
      )}

      <div className="glass-panel rounded-lg p-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {FIELDS.map(({ key, label, type, tone }) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span
                className={cn(
                  "text-[10px] font-extrabold uppercase tracking-widest",
                  tone === "error" ? "text-error" : "text-on-surface-variant/70",
                )}
              >
                {label}
              </span>
              <input
                type={type}
                value={grid[key]}
                onChange={(e) => set(key, e.target.value)}
                className={cn(
                  "sunken rounded-lg px-3 py-2.5 font-mono text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40",
                  drafting && "animate-pulse",
                )}
              />
            </label>
          ))}
        </div>

        <label className="mt-5 flex flex-col gap-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
            Time Exit Condition
          </span>
          <input
            type="text"
            placeholder='e.g. "Chetak share &lt; 15%"'
            value={grid.time_exit_condition}
            onChange={(e) => set("time_exit_condition", e.target.value)}
            className="sunken rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </label>
      </div>

      {draftNotes && (
        <div className="rounded-lg bg-secondary-container/30 px-4 py-3">
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-secondary">
            Jarvis&apos;s note
          </p>
          <p className="text-sm leading-relaxed text-on-surface/90">{draftNotes}</p>
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="glass-panel rounded-lg p-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Risk / Reward
            </p>
            <p className="mt-1 font-display text-xl font-extrabold text-on-surface">
              {metrics.riskReward !== null ? `${metrics.riskReward.toFixed(2)}:1` : "—"}
            </p>
          </div>
          <div className="glass-panel rounded-lg p-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Max Drawdown
            </p>
            <p className="mt-1 font-display text-xl font-extrabold text-error">
              {metrics.maxDrawdownPct.toFixed(1)}%
            </p>
          </div>
          <div className="glass-panel rounded-lg p-4">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Cash at Risk
            </p>
            <p className="mt-1 font-display text-xl font-extrabold text-on-surface">
              {formatCurrency(metrics.cashAtRisk, exchange)}
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      <button
        type="button"
        onClick={handleLock}
        disabled={!canLock || submitting}
        className="self-start rounded-full bg-primary px-6 py-3 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
      >
        {submitting ? "Locking…" : "Lock & Save Plan"}
      </button>
    </div>
  );
}
