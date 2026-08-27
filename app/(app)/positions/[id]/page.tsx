"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { computePositionPnl, computeDistanceToStop } from "@/lib/position-metrics";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { formatCurrency } from "@/lib/format";
import { ExitLadder } from "@/components/positions/exit-ladder";
import { LogTrimModal } from "@/components/positions/log-trim-modal";
import { StopExitModal } from "@/components/positions/stop-exit-modal";
import { ThesisMetricsPanel } from "@/components/positions/thesis-metrics-panel";
import { DisciplineBanner } from "@/components/positions/discipline-banner";
import { PriceBadge } from "@/components/shared/price-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type { Entry, Exit, Position, Thesis, TradePlan, Stock } from "@/lib/types";

type Detail = {
  position: Position;
  entries: Entry[];
  exits: Exit[];
  tradePlan: TradePlan | null;
  thesis: Thesis | null;
  stock: Stock | null;
};

/**
 * Screen 5–6: the single position view that enforces exit discipline —
 * P&L + thesis health on the left, the exit ladder on the right, and the
 * blocking stop-hit / T1-hit banner above both (US-04, US-15, US-16, US-17).
 */
export default function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [cmp, setCmp] = useState<number | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [trimTier, setTrimTier] = useState<"trim_t1" | "trim_t2" | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Same shape as `app/(app)/thesis/[id]/page.tsx`: `load` lives inside the
  // effect and a mutation just bumps `reloadKey`, and the on-demand price
  // refresh (spec: never poll while the page is open) is isolated in its own
  // try/catch so a failed quote can't blow away the position already loaded.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/positions/${id}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Position not found.");
        if (cancelled) return;
        setDetail(body);
        setCmp(body.stock?.last_price ?? null);
        setPriceAsOf(body.stock?.last_price_at ?? null);
        if (body.stock?.id) {
          try {
            const priceRes = await fetch("/api/prices/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stockIds: [body.stock.id] }),
            });
            if (priceRes.ok) {
              const priceBody = await priceRes.json();
              const quote = priceBody.prices?.[body.stock.id];
              if (!cancelled && quote) {
                setCmp(quote.price);
                setPriceAsOf(quote.asOf);
              }
            }
          } catch {
            // Swallowed: CMP/LastUpdated fall back to the stored last_price.
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

  function handleSaved(promptJournal: boolean) {
    setTrimTier(null);
    setStopModalOpen(false);
    if (promptJournal) {
      // Task 22's response says the position just went to zero — Screen 7
      // (the journal) is the mandatory next step, not an optional detour.
      router.push(`/journal/new?positionId=${id}`);
    } else {
      setReloadKey((k) => k + 1);
    }
  }

  if (loading) return <SkeletonLoader lines={8} />;

  if (error || !detail || !detail.tradePlan) {
    return (
      <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
        {error ?? (detail ? "This position has no trade plan." : "Position not found.")}{" "}
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="underline">
          Retry
        </button>
      </div>
    );
  }

  const { position, entries, exits, tradePlan, thesis, stock } = detail;
  const exchange = stock?.exchange ?? "US";
  const weightedAverage = computeWeightedAverageEntry(entries);
  const remaining = weightedAverage.totalQuantity - exits.reduce((sum, e) => sum + e.quantity, 0);
  const pnl =
    cmp !== null && weightedAverage.averagePrice > 0
      ? computePositionPnl({ currentPrice: cmp, avgEntry: weightedAverage.averagePrice, quantity: remaining })
      : null;
  const distToStop = cmp !== null ? computeDistanceToStop({ currentPrice: cmp, stopLoss: tradePlan.stop_loss }) : null;
  const distToT1 = cmp !== null && tradePlan.target_1 !== null ? tradePlan.target_1 - cmp : null;
  const distToT2 = cmp !== null && tradePlan.target_2 !== null ? tradePlan.target_2 - cmp : null;

  return (
    <div>
      <DisciplineBanner
        ticker={position.ticker}
        currentPrice={cmp}
        exchange={exchange}
        stopLoss={tradePlan.stop_loss}
        target1={tradePlan.target_1}
        t1Trimmed={exits.some((e) => e.type === "trim_t1")}
        onExitNow={() => setStopModalOpen(true)}
        onLogTrim={() => setTrimTier("trim_t1")}
      />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-on-surface">{position.ticker}</h1>
          <p className="mt-1 text-xs text-on-surface/50">
            {remaining} of {weightedAverage.totalQuantity} shares held · {position.status.replace("_", " ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PriceBadge price={cmp} exchange={exchange} />
          <LastUpdated at={priceAsOf} exchange={exchange} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Avg Entry</p>
            <p className="font-mono text-lg text-on-surface">
              {formatCurrency(weightedAverage.averagePrice, exchange)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Return</p>
              <p className={`font-mono text-lg ${pnl && pnl.percent >= 0 ? "text-status-green" : "text-status-red"}`}>
                {pnl ? `${pnl.percent >= 0 ? "+" : ""}${pnl.percent.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to Stop</p>
              <p className={`font-mono text-lg ${distToStop && distToStop.rupees <= 0 ? "text-status-red" : "text-on-surface"}`}>
                {distToStop ? formatCurrency(distToStop.rupees, exchange) : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to T1</p>
              <p className="font-mono text-lg text-on-surface">
                {distToT1 !== null ? formatCurrency(distToT1, exchange) : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to T2</p>
              <p className="font-mono text-lg text-on-surface">
                {distToT2 !== null ? formatCurrency(distToT2, exchange) : "—"}
              </p>
            </div>
          </div>
          <ThesisMetricsPanel
            tradePlanId={tradePlan.id}
            // `?? []` guards the window where `0010_trade_plan_thesis_conditions.sql`
            // hasn't been applied to an environment yet: the column is `not null
            // default '[]'` once it exists, but until then this screen would
            // crash on an undefined array rather than degrade to "no conditions".
            conditions={tradePlan.thesis_conditions ?? []}
            warningText={thesis?.invalidation_condition ?? null}
          />
        </div>

        <ExitLadder
          tradePlan={tradePlan}
          exits={exits}
          currentPrice={cmp}
          onLogTrim={setTrimTier}
          onLogStop={() => setStopModalOpen(true)}
        />
      </div>

      {trimTier && (
        <LogTrimModal positionId={position.id} tier={trimTier} onClose={() => setTrimTier(null)} onSaved={handleSaved} />
      )}
      {stopModalOpen && (
        <StopExitModal
          positionId={position.id}
          remainingQuantity={remaining}
          onClose={() => setStopModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
