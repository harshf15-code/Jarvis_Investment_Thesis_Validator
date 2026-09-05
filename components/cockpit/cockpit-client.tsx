"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { PortfolioSummary, type CurrencyTotal } from "@/components/cockpit/portfolio-summary";
import { AlertRail } from "@/components/cockpit/alert-rail";
import { CoinGeckoAttribution } from "@/components/shared/coingecko-attribution";
import { PositionsTable, type PositionRow } from "@/components/positions/positions-table";
import {
  RecommendationStats,
  type RecommendationStatsRow,
} from "@/components/recommendations/recommendation-stats";
import { OwnershipBadge } from "@/components/portfolio/ownership-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { LastUpdated } from "@/components/shared/last-updated";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { useNewThesisDrawer } from "@/components/layout/new-thesis-context";
import { formatCurrency } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

type BookTotals = {
  portfolio: Portfolio;
  totalsByCurrency: CurrencyTotal[];
  positionCount: number;
};

type Cockpit = {
  positions: PositionRow[];
  recommendations: RecommendationStatsRow[];
  totalsByCurrency: CurrencyTotal[];
  overdueTickers: string[];
  scope: { mode: "one" | "all"; portfolios: Portfolio[] };
  byPortfolio: BookTotals[];
};

/**
 * The Cockpit's one aggregated read (`GET /api/cockpit`), assembled into the
 * whole situational picture — P&L, the alert rail, open positions, and the
 * Jarvis recommendation scoreboard (US-01, US-02).
 *
 * A client screen because the "New Thesis" affordance needs
 * `useNewThesisDrawer` and `<PositionsTable/>` is itself interactive; the fetch
 * runs in the browser, which carries the session cookie natively.
 *
 * `scopeParam` comes from the server wrapper, which has already resolved a bare
 * URL to a named book — so this never has to guess which portfolio it is
 * showing, and never renders one book's numbers under another's name.
 */
export function CockpitClient({ scopeParam }: { scopeParam: string }) {
  const { open } = useNewThesisDrawer();
  const [data, setData] = useState<Cockpit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const res = await fetch(`/api/cockpit?portfolio=${scopeParam}`);
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
  }, [reloadKey, scopeParam]);

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

  const rollUp = data.scope.mode === "all";
  const book = rollUp ? null : (data.scope.portfolios[0] ?? null);
  // In the roll-up the headline sums owned books only, so the managed ones are
  // rendered separately below. Naming them there is what stops the top number
  // reading as "everything I have" when it deliberately is not.
  const managed = data.byPortfolio.filter((b) => b.portfolio.ownership === "managed");

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* The book's name, not the product's. When there was one portfolio the
            title could afford to be decoration; with five, "which book am I
            looking at" is the single most valuable string on the screen. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate font-display text-2xl text-on-surface">
            {rollUp ? "All portfolios" : (book?.name ?? "Cockpit")}
          </h1>
          {rollUp ? (
            <span className="shrink-0 text-xs text-on-surface-variant">
              {data.byPortfolio.length} books
            </span>
          ) : (
            book && <OwnershipBadge portfolio={book} />
          )}
        </div>
        <button
          type="button"
          onClick={() => open()}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          New Thesis
        </button>
      </div>

      {rollUp && managed.length > 0 && (
        <p className="mb-3 text-xs text-on-surface-variant">
          The total below is your own money only. {managed.length === 1 ? "One book is" : `${managed.length} books are`}{" "}
          managed for someone else and {managed.length === 1 ? "is" : "are"} listed separately.
        </p>
      )}

      <PortfolioSummary
        totalsByCurrency={data.totalsByCurrency}
        positionCount={data.positions.length}
        pendingRecCount={pendingRecCount}
      />
      {/* These totals are partly CoinGecko-derived whenever a coin is held, so
          the credit belongs beside them and not only beside the table below. */}
      <CoinGeckoAttribution
        show={data.positions.some((p) => p.stock?.asset_class === "crypto")}
        className="mt-1.5"
      />

      {rollUp && (
        <div className="mt-6">
          <h2 className="mb-3 font-display text-sm uppercase text-on-surface/50">By portfolio</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.byPortfolio.map(({ portfolio, totalsByCurrency, positionCount }) => (
              <div key={portfolio.id} className="rounded-xl bg-surface-container-low p-4">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-display text-sm text-on-surface">
                    {portfolio.name}
                  </p>
                  <OwnershipBadge portfolio={portfolio} />
                </div>
                {totalsByCurrency.length === 0 ? (
                  <p className="mt-1.5 font-mono text-sm tabular-nums text-on-surface/40">—</p>
                ) : (
                  totalsByCurrency.map((total) => {
                    const sign = total.absolute >= 0 ? "+" : "";
                    return (
                      <p
                        key={total.currency}
                        className={`mt-1.5 font-mono text-sm tabular-nums ${total.absolute >= 0 ? "text-status-green" : "text-status-red"}`}
                      >
                        {sign}
                        {formatCurrency(total.absolute, total.currency)} ({sign}
                        {total.percent.toFixed(2)}%)
                      </p>
                    );
                  })
                )}
                <p className="mt-1 text-[11px] text-on-surface-variant">
                  {positionCount} {positionCount === 1 ? "position" : "positions"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <Link href={`/positions?portfolio=${scopeParam}`} className="text-xs text-primary underline">
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
