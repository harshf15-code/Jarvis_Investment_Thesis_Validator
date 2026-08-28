"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { computeRiskReward, computeMaxDrawdownPct } from "@/lib/risk-reward";
import { CandidateBakeoff } from "@/components/thesis/candidate-bakeoff";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import { PriceBadge } from "@/components/shared/price-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type {
  BearCase,
  ConvictionTier,
  ExchangeCode,
  Json,
  ThesisMode,
  TradePlan,
} from "@/lib/types";

type ThesisDetail = {
  id: string;
  stock_id: string | null;
  ticker: string | null;
  mode: ThesisMode;
  selected_candidate_id: string | null;
  market_view: string | null;
  mispricing: string | null;
  catalyst: string | null;
  time_horizon: string | null;
  invalidation_condition: string | null;
  conviction_tier: ConvictionTier | null;
  conviction_score: number | null;
  bear_cases: BearCase[];
  created_at: string;
};

const NARRATIVE_FIELDS: { key: keyof ThesisDetail; label: string }[] = [
  { key: "market_view", label: "Market View" },
  { key: "mispricing", label: "Mispricing" },
  { key: "catalyst", label: "Catalyst" },
  { key: "time_horizon", label: "Time Horizon" },
  { key: "invalidation_condition", label: "Invalidation" },
];

// `type` drives both the <input>'s native control and whether `handleFieldEdit`
// coerces the typed value to a number — `time_exit_date` is a date string and
// must never be run through `Number(...)` (that yields NaN, which
// `JSON.stringify` silently turns into `null`, discarding the date).
const PLAN_FIELDS: { key: keyof TradePlan; label: string; type: "number" | "date" }[] = [
  { key: "entry_zone_low", label: "Entry Low", type: "number" },
  { key: "entry_zone_high", label: "Entry High", type: "number" },
  { key: "add_tranche_low", label: "Add Low", type: "number" },
  { key: "add_tranche_high", label: "Add High", type: "number" },
  { key: "stop_loss", label: "Stop Loss", type: "number" },
  { key: "target_1", label: "Target 1", type: "number" },
  { key: "target_2", label: "Target 2", type: "number" },
  { key: "position_size_pct", label: "Size %", type: "number" },
  { key: "time_exit_date", label: "Time Exit", type: "date" },
];

export default function ThesisReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [thesis, setThesis] = useState<ThesisDetail | null>(null);
  const [tradePlan, setTradePlan] = useState<TradePlan | null>(null);
  const [cmp, setCmp] = useState<number | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [exchange, setExchange] = useState<ExchangeCode>("US");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // `load` is declared inside the effect (rather than as a shared
  // component-scope function called from it) so a mutation only needs to
  // bump `reloadKey` to trigger a refetch — matches `[id]/plan/page.tsx`'s
  // convention and keeps state updates out of the effect's own call graph.
  // Same error-handling shape as that sibling page's `fetchThesis`: this is
  // the shared "view any thesis" destination other tasks link into (stale
  // links, deleted theses), so a non-ok response must render a retryable
  // error state instead of throwing on `body.thesis` being undefined.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/theses/${id}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Thesis not found.");
        if (cancelled) return;
        setThesis(body.thesis);
        setTradePlan(body.tradePlan);
        if (body.stock?.exchange) setExchange(body.stock.exchange);
        if (body.thesis.stock_id) {
          // Isolated from the outer try/catch on purpose — a failed refresh
          // is not fatal (matches `[id]/plan/page.tsx`'s `fetchQuote`
          // comment: "the caller falls back to the stock's stored
          // `last_price`"). It must never propagate into the outer `catch`
          // and blow away the thesis/trade-plan data already set above.
          try {
            const priceRes = await fetch("/api/prices/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stockIds: [body.thesis.stock_id] }),
            });
            if (priceRes.ok) {
              const priceBody = await priceRes.json();
              const quote = priceBody.prices?.[body.thesis.stock_id];
              if (!cancelled && quote) {
                setCmp(quote.price);
                setPriceAsOf(quote.asOf);
              }
            }
          } catch {
            // Swallowed: CMP/LastUpdated just render their "unavailable" state.
          }
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  function refresh() {
    setReloadKey((k) => k + 1);
  }

  async function patchTradePlan(field: keyof TradePlan, value: unknown) {
    if (!tradePlan) return;
    await fetch(`/api/trade-plans/${tradePlan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    refresh();
  }

  function handleFieldEdit(field: keyof TradePlan, type: "number" | "date", value: string) {
    if (value.trim() === "") {
      return patchTradePlan(field, null);
    }
    const coerced = type === "number" ? Number(value) : value;
    if (type === "number" && !Number.isFinite(coerced)) return;
    return patchTradePlan(field, coerced);
  }

  /**
   * US-07: "A 'Reset to AI suggestion' link appears on hover of any edited
   * field." Sends the field's original `ai_suggested` value straight back
   * through the same PATCH endpoint — `PATCH /api/trade-plans/:id` already
   * removes a field from `edited_fields` whenever the posted value equals
   * `ai_suggested[field]`, so no separate "reset" endpoint is needed.
   */
  function handleResetField(field: keyof TradePlan) {
    if (!tradePlan) return;
    const aiSuggested = (tradePlan.ai_suggested ?? {}) as Record<string, Json | undefined>;
    return patchTradePlan(field, aiSuggested[field] ?? null);
  }

  /** Ruling: re-runs the stress test only (Task 20's route) — thesis structuring already happened in Screen 1 and locked trade-plan numbers are user-owned once set. No separate "last regenerated" timestamp column exists (Task 1's schema is already live); `thesis.created_at` is shown as the closest available proxy rather than adding a migration for this cosmetic timestamp. */
  async function handleRerun() {
    setRerunning(true);
    try {
      await fetch(`/api/theses/${id}/stress-test`, { method: "POST" });
      refresh();
    } finally {
      setRerunning(false);
    }
  }

  if (loading) return <SkeletonLoader lines={8} />;

  if (error || !thesis) {
    return (
      <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
        {error ?? "Thesis not found."}{" "}
        <button type="button" onClick={refresh} className="underline">
          Retry
        </button>
      </div>
    );
  }

  const riskReward =
    tradePlan?.stop_loss != null && tradePlan?.entry_zone_low != null && tradePlan?.target_1 != null
      ? computeRiskReward({ entry: tradePlan.entry_zone_low, stop: tradePlan.stop_loss, target: tradePlan.target_1 })
      : null;
  const maxDrawdown =
    tradePlan?.stop_loss != null && tradePlan?.entry_zone_low != null
      ? computeMaxDrawdownPct({ entry: tradePlan.entry_zone_low, stop: tradePlan.stop_loss })
      : null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-on-surface">{thesis.ticker ?? "Macro Thesis"}</h1>
          <p className="mt-1 text-xs text-on-surface/50">Last analysed {new Date(thesis.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-3">
          {thesis.conviction_tier && <ConvictionBadge tier={thesis.conviction_tier} />}
          <PriceBadge price={cmp} exchange={exchange} />
          <LastUpdated at={priceAsOf} exchange={exchange} />
        </div>
      </div>

      {thesis.conviction_score !== null && (
        <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${thesis.conviction_score}%` }}
          />
        </div>
      )}

      {thesis.mode === "thesis_only" && (
        <div className="mb-6">
          {/*
            Re-surfaced here, not just in the creation drawer: a macro thesis
            saved as a draft has no instrument yet, and this is where the user
            comes back to resolve it into one.
          */}
          <CandidateBakeoff
            thesisId={id}
            selectedCandidateId={thesis.selected_candidate_id}
            autoRun={false}
            onPicked={refresh}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Thesis</h2>
          {NARRATIVE_FIELDS.map(({ key, label }) => (
            <div key={key} className="rounded-xl bg-surface-container-low p-4">
              <p className="mb-1 text-xs uppercase text-on-surface/50">{label}</p>
              <p className="text-sm text-on-surface">{(thesis[key] as string | null) ?? "—"}</p>
            </div>
          ))}
          <div className="flex flex-col gap-3">
            <h3 className="font-display text-sm uppercase text-on-surface/50">Bear Cases</h3>
            {thesis.bear_cases.map((bc, i) => (
              <div key={i} className="rounded-xl bg-surface-container-low p-3 text-sm">
                <p className="text-status-red">{bc.reason}</p>
                <p className="mt-1 text-status-green">{bc.counter}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            className="self-start rounded-xl bg-surface-container-highest px-4 py-2 text-xs text-on-surface/70 hover:text-on-surface disabled:opacity-40"
          >
            {rerunning ? "Re-running..." : "Re-run AI Analysis"}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Trade Plan</h2>
          {tradePlan ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                {PLAN_FIELDS.map(({ key, label, type }) => {
                  const edited = tradePlan.edited_fields.includes(key);
                  return (
                    <label
                      // Remount the (uncontrolled) input whenever the trade
                      // plan is reloaded, so its `defaultValue` re-applies —
                      // without this, a Reset (or a value the server
                      // normalized) would silently not show on screen.
                      key={`${key}-${tradePlan.updated_at}`}
                      className="group relative flex flex-col gap-1"
                    >
                      <span className="flex items-center justify-between text-xs text-on-surface/50">
                        {label}
                        {edited && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleResetField(key)}
                            className="hidden text-[10px] font-medium text-primary underline decoration-primary/60 underline-offset-2 hover:text-primary/80 group-hover:inline"
                          >
                            Reset to AI suggestion
                          </button>
                        )}
                      </span>
                      <input
                        type={type}
                        defaultValue={(tradePlan[key] as string | number | null) ?? ""}
                        onBlur={(e) => handleFieldEdit(key, type, e.target.value)}
                        className={`rounded-lg px-3 py-2 text-sm font-mono ${
                          edited
                            ? "bg-surface-container-highest text-primary underline decoration-primary decoration-2 underline-offset-4"
                            : "bg-surface-container-highest text-on-surface"
                        }`}
                      />
                    </label>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs text-on-surface/50">Risk/Reward</p>
                  <p className="font-mono text-lg text-on-surface">{riskReward !== null ? `${riskReward.toFixed(2)}:1` : "—"}</p>
                </div>
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs text-on-surface/50">Max Drawdown</p>
                  <p className="font-mono text-lg text-on-surface">{maxDrawdown !== null ? `${maxDrawdown.toFixed(1)}%` : "—"}</p>
                </div>
              </div>
            </>
          ) : (
            <Link
              href={`/thesis/${id}/plan`}
              className="rounded-xl bg-primary px-4 py-2 text-center text-sm font-medium text-on-primary"
            >
              Build Trade Plan
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
