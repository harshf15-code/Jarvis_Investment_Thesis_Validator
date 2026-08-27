"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { PortfolioSummary } from "@/components/cockpit/portfolio-summary";
import { AlertRail } from "@/components/cockpit/alert-rail";
import { PositionsTable, type PositionRow } from "@/components/positions/positions-table";
import {
  RecommendationStats,
  type RecommendationStatsRow,
} from "@/components/recommendations/recommendation-stats";
import { EmptyState } from "@/components/shared/empty-state";
import { LastUpdated } from "@/components/shared/last-updated";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { useNewThesisDrawer } from "@/components/layout/new-thesis-context";
import type { ExchangeCode } from "@/lib/types";

type Cockpit = {
  positions: PositionRow[];
  recommendations: RecommendationStatsRow[];
  totalOpenPnl: { absolute: number; percent: number };
  overdueTickers: string[];
};

/**
 * Screen HUB-1 — the Velocity Cockpit. The app's front door: one aggregated
 * read (`GET /api/cockpit`) assembled into the whole situational picture —
 * portfolio P&L, the alert rail, open positions, and the Jarvis
 * recommendation scoreboard (US-01, US-02).
 *
 * A client screen rather than a server one because the "New Thesis" affordance
 * needs `useNewThesisDrawer` and `<PositionsTable/>` is itself interactive; the
 * fetch runs in the browser, which carries the session cookie natively, so
 * `fetchInternalApi` (the server-component self-fetch helper) doesn't apply.
 */
export default function CockpitPage() {
  const { open } = useNewThesisDrawer();
  const [data, setData] = useState<Cockpit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const res = await fetch("/api/cockpit");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the cockpit.");
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
        {error}{" "}
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <SkeletonLoader lines={6} />;

  const pendingRecCount = data.recommendations.filter(
    (r) => !r.recommendation.converted_to_position,
  ).length;

  // The book's currency, when it has exactly one — a total that mixes NSE and
  // US positions can't be stamped with a single symbol (see PortfolioSummary).
  const exchanges = new Set(
    data.positions.map((r) => r.stock?.exchange).filter((e): e is ExchangeCode => e != null),
  );
  const summaryExchange = exchanges.size === 1 ? [...exchanges][0] : null;

  // Spec Section 5: the freshest quote behind anything on this screen, stamped
  // in its own exchange's timezone. Prices are never polled — this reflects
  // whatever the last on-demand refresh stored.
  const freshest = data.positions.reduce<PositionRow | null>(
    (latest, row) =>
      row.stock?.last_price_at &&
      (!latest?.stock?.last_price_at || row.stock.last_price_at > latest.stock.last_price_at)
        ? row
        : latest,
    null,
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl text-on-surface">Velocity Cockpit</h1>
        <button
          type="button"
          onClick={() => open()}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          New Thesis
        </button>
      </div>

      <PortfolioSummary
        totalOpenPnl={data.totalOpenPnl}
        exchange={summaryExchange}
        positionCount={data.positions.length}
        pendingRecCount={pendingRecCount}
      />

      <div className="mt-6">
        <AlertRail positions={data.positions} overdueTickers={data.overdueTickers} />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-sm uppercase text-on-surface/50">Active Positions</h2>
            <LastUpdated
              at={freshest?.stock?.last_price_at ?? null}
              exchange={freshest?.stock?.exchange ?? "NSE"}
            />
          </div>
          <Link href="/positions" className="text-xs text-primary underline">
            View all
          </Link>
        </div>
        {data.positions.length === 0 ? (
          <EmptyState title="No active positions." description="Start with a thesis →" />
        ) : (
          <PositionsTable rows={data.positions} />
        )}
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm uppercase text-on-surface/50">Jarvis Recommendations</h2>
          <Link href="/recommendations" className="text-xs text-primary underline">
            View tracker
          </Link>
        </div>
        {data.recommendations.length === 0 ? (
          <EmptyState
            title="No Jarvis recommendations yet."
            description="Build a trade plan to start tracking."
          />
        ) : (
          <RecommendationStats rows={data.recommendations} compact />
        )}
      </div>
    </div>
  );
}
