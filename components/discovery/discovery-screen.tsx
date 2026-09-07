"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { OpportunityCard } from "@/components/discovery/opportunity-card";
import { AddWatchlistModal } from "@/components/discovery/add-watchlist-modal";
import { EmptyState } from "@/components/shared/empty-state";
import { LastUpdated } from "@/components/shared/last-updated";
import type { ConvictionTier } from "@/lib/types";

export type Row = Parameters<typeof OpportunityCard>[0]["row"];

const TIER_ORDER: Record<ConvictionTier, number> = { I: 0, II: 1, III: 2, IV: 3 };

/**
 * The interactive half of `/discovery`: the tier filter, the sort, and the
 * Add-to-Watchlist modal.
 *
 * `rows` are read on the SERVER by `readOpportunities` and arrive in the HTML.
 * This used to mount, render a skeleton and then fetch `/api/opportunities` —
 * a browser round trip that could not start until React had hydrated. Adding a
 * stock now calls `router.refresh()`, which re-runs the server read and leaves
 * the current cards on screen while it does.
 */
export function DiscoveryScreen({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [tierFilter, setTierFilter] = useState<ConvictionTier | "all">("all");
  const [sortBy, setSortBy] = useState<"tier" | "pe" | "recency">("tier");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => {
    const byTier = tierFilter === "all" ? rows : rows.filter((r) => r.opportunity.conviction_tier === tierFilter);
    /** Spec US-20: sort options are Conviction Tier (default) / PE / Recency — deliberately no "Trending"/"Popular". */
    return [...byTier].sort((a, b) => {
      if (sortBy === "pe") return (a.opportunity.pe ?? Infinity) - (b.opportunity.pe ?? Infinity);
      if (sortBy === "recency") return b.opportunity.created_at.localeCompare(a.opportunity.created_at);
      const tierA = a.opportunity.conviction_tier ? TIER_ORDER[a.opportunity.conviction_tier] : 4;
      const tierB = b.opportunity.conviction_tier ? TIER_ORDER[b.opportunity.conviction_tier] : 4;
      return tierA - tierB;
    });
  }, [rows, tierFilter, sortBy]);

  // Spec Section 5: the freshest quote behind any card on this screen, stamped
  // in its own exchange's timezone — same pattern as Task 24's Cockpit page.
  const freshest = rows.reduce<Row | null>(
    (latest, r) => (r.lastPriceAt && (!latest?.lastPriceAt || r.lastPriceAt > latest.lastPriceAt) ? r : latest),
    null,
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl text-on-surface">Opportunity Discovery</h1>
          <LastUpdated at={freshest?.lastPriceAt ?? null} exchange={freshest?.opportunity.market ?? "NSE"} />
        </div>
        <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-on-primary">
          <Plus className="size-4" /> Add to Watchlist
        </button>
      </div>

      <div className="mb-6 flex gap-3">
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as ConvictionTier | "all")} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          <option value="all">All Tiers</option>
          {(["I", "II", "III", "IV"] as ConvictionTier[]).map((t) => (
            <option key={t} value={t}>Tier {t}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          <option value="tier">Sort: Conviction Tier</option>
          <option value="pe">Sort: PE</option>
          <option value="recency">Sort: Recency</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No opportunities yet." description="Add a stock to your watchlist to start tracking →" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <OpportunityCard key={row.opportunity.id} row={row} />
          ))}
        </div>
      )}

      {addOpen && (
        <AddWatchlistModal
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
