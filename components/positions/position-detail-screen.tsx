"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { computePositionPnl, computeDistanceToStop } from "@/lib/position-metrics";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { currencyForExchange } from "@/lib/markets";
import { formatCurrency } from "@/lib/format";
import { ExitLadder } from "@/components/positions/exit-ladder";
import { ExitPlanPanel } from "@/components/positions/exit-plan-panel";
import { LogTrimModal } from "@/components/positions/log-trim-modal";
import { StopExitModal } from "@/components/positions/stop-exit-modal";
import { ThesisMetricsPanel } from "@/components/positions/thesis-metrics-panel";
import { DisciplineBanner } from "@/components/positions/discipline-banner";
import { HoldingRationalePanel } from "@/components/positions/holding-rationale-panel";
import { statedRationale } from "@/lib/holding-watch";
import { HoldingReviewsPanel } from "@/components/positions/reviews/holding-reviews-panel";
import { PriceBadge } from "@/components/shared/price-badge";
import { CoinGeckoAttribution } from "@/components/shared/coingecko-attribution";
import { LastUpdated } from "@/components/shared/last-updated";
import type { PositionDetail } from "@/lib/queries";

/**
 * Screen 5–6: the single position view that enforces exit discipline —
 * P&L + thesis health on the left, the exit ladder on the right, and the
 * blocking stop-hit / T1-hit banner above both (US-04, US-15, US-16, US-17).
 *
 * `detail` is read on the SERVER by `readPositionDetail` and arrives in the
 * HTML. This screen used to fetch it after mounting and then, only once that
 * had landed, ask for a fresh quote — two round trips in series behind a wait
 * for hydration, on the slowest screen in the app.
 *
 * The quote is still fetched from the browser, and deliberately so: the spec
 * says never poll while the page is open, so a price refresh is an on-demand
 * request and not something to block a render on. What changed is that it no
 * longer waits for anything — the whole position is already on screen when it
 * goes out, and `stock.last_price` is what shows until it answers.
 */
export function PositionDetailScreen({ detail }: { detail: PositionDetail }) {
  const router = useRouter();
  const { position, entries, exits, thesis } = detail;
  const id = position.id;

  const [cmp, setCmp] = useState<number | null>(detail.stock?.last_price ?? null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(detail.stock?.last_price_at ?? null);
  /** Corrected by the refresh below: a currency seeded from `exchange` (0021)
   *  is wrong for a coin, and the quote is what knows better. */
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [trimTier, setTrimTier] = useState<"trim_t1" | "trim_t2" | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);

  const stockId = detail.stock?.id ?? null;
  useEffect(() => {
    if (!stockId) return;
    let cancelled = false;

    async function refreshPrice() {
      try {
        const res = await fetch("/api/prices/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockIds: [stockId] }),
        });
        if (!res.ok) return;
        const body = await res.json();
        const quote = body.prices?.[stockId as string];
        if (cancelled || !quote) return;
        setCmp(quote.price);
        setPriceAsOf(quote.asOf);
        if (quote.currency) setCurrencyOverride(quote.currency);
      } catch {
        // Swallowed: CMP/LastUpdated fall back to the stored last_price.
      }
    }

    refreshPrice();
    return () => {
      cancelled = true;
    };
  }, [stockId]);

  function handleSaved(promptJournal: boolean) {
    setTrimTier(null);
    setStopModalOpen(false);
    if (promptJournal) {
      // Task 22's response says the position just went to zero — Screen 7
      // (the journal) is the mandatory next step, not an optional detour.
      router.push(`/journal/new?positionId=${id}`);
    } else {
      // Re-runs the server read, which is where `detail` comes from now.
      router.refresh();
    }
  }

  const { tradePlan } = detail;
  if (!tradePlan) {
    return (
      <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
        This position has no trade plan.
      </div>
    );
  }

  const stock = detail.stock;
  const exchange = stock?.exchange ?? "US";
  // `exchange` still drives the timezone a price is stamped in; `currency`
  // drives what the money is called. They are different questions and a US
  // fallback is only defensible for the first one.
  const currency = currencyOverride ?? stock?.currency ?? currencyForExchange(exchange);
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
        currency={currency}
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
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            <PriceBadge price={cmp} currency={currency} />
            <LastUpdated at={priceAsOf} exchange={exchange} />
          </div>
          {/* Beside the price it credits, per CoinGecko's attribution guide. */}
          <CoinGeckoAttribution show={stock?.asset_class === "crypto"} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface/50">Avg Entry</p>
            <p className="font-mono text-lg text-on-surface">
              {formatCurrency(weightedAverage.averagePrice, currency)}
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
              <p className={`font-mono text-lg ${distToStop && distToStop.absolute <= 0 ? "text-status-red" : "text-on-surface"}`}>
                {distToStop ? formatCurrency(distToStop.absolute, currency) : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to T1</p>
              <p className="font-mono text-lg text-on-surface">
                {distToT1 !== null ? formatCurrency(distToT1, currency) : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="text-xs text-on-surface/50">Dist. to T2</p>
              <p className="font-mono text-lg text-on-surface">
                {distToT2 !== null ? formatCurrency(distToT2, currency) : "—"}
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

      {/* Imported holdings only. A Jarvis position already has a reason behind
          it — the whole thesis — and the route refuses to rewrite that text. */}
      {thesis?.source === "imported" && (
        <div className="mt-6">
          <HoldingRationalePanel
            thesisId={thesis.id}
            ticker={position.ticker}
            inputText={thesis.input_text}
            onSaved={() => router.refresh()}
          />
        </div>
      )}

      {/* Below the ladder rather than replacing it: the point is to see WHY
          every rung reads PENDING, which needs both on screen at once. */}
      {thesis?.source === "imported" && (
        <div className="mt-6">
          <ExitPlanPanel
            positionId={position.id}
            ticker={position.ticker}
            tradePlan={tradePlan}
            currency={currency}
            hasRationale={statedRationale(thesis.input_text, position.ticker) !== null}
            onSaved={() => router.refresh()}
          />
        </div>
      )}

      <div className="mt-6">
        <HoldingReviewsPanel
          positionId={position.id}
          reviews={detail.reviews ?? []}
          queued={detail.watch !== null && detail.watch.last_checked_at === null}
          watched={thesis?.source === "imported"}
          // Not `handleSaved`: that one pushes to the journal when a position
          // has just gone to zero. A new read only needs the page re-rendered.
          onReviewed={() => router.refresh()}
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
