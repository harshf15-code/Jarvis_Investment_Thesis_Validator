// components/discovery/opportunity-card.tsx
import Link from "next/link";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import { PriceBadge } from "@/components/shared/price-badge";
import type { ConvictionTier, ExchangeCode } from "@/lib/types";

type Row = {
  opportunity: {
    id: string;
    created_at: string;
    ticker: string;
    sector: string | null;
    conviction_tier: ConvictionTier | null;
    thesis_summary: string | null;
    pe: number | null;
    sector_median_pe: number | null;
    fifty_two_week_low: number | null;
    fifty_two_week_high: number | null;
    market: ExchangeCode;
    watching_only: boolean;
  };
  currentPrice: number | null;
  lastPriceAt: string | null;
  held: boolean;
  draft: boolean;
};

/** Spec US-20/US-21. "Explore" reuses Task 10's page via its existing `?ticker=` searchParam — no new route needed. */
export function OpportunityCard({ row }: { row: Row }) {
  const { opportunity: o, currentPrice, held, draft } = row;

  const near52wHigh =
    currentPrice !== null && o.fifty_two_week_high !== null && currentPrice > o.fifty_two_week_high * 0.85;

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm text-on-surface">{o.ticker}</span>
        <div className="flex items-center gap-2">
          {o.watching_only && <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] text-on-surface/50">WATCHING</span>}
          {held && <span className="rounded-full bg-status-green-container px-2 py-0.5 text-[10px] text-status-green">HELD</span>}
          {draft && <span className="rounded-full bg-primary-container px-2 py-0.5 text-[10px] text-primary">DRAFT</span>}
          {o.conviction_tier && <ConvictionBadge tier={o.conviction_tier} />}
        </div>
      </div>
      <p className="text-xs text-on-surface/50">{o.sector ?? "—"}</p>
      {o.thesis_summary && <p className="line-clamp-2 text-sm text-on-surface/80">{o.thesis_summary}</p>}
      <div className="flex items-center justify-between text-xs text-on-surface/60">
        <span>PE {o.pe ?? "—"} vs sector {o.sector_median_pe ?? "—"}</span>
        <PriceBadge price={currentPrice} exchange={o.market} />
      </div>
      {near52wHigh && (
        <span className="w-fit rounded-full bg-primary-container px-2 py-0.5 text-[10px] text-primary">Near 52W High ⚠</span>
      )}
      <Link
        href={held ? `/positions` : draft ? `/thesis` : `/thesis/new?ticker=${o.ticker}`}
        className="rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-medium text-on-primary"
      >
        {held || draft ? "Review Thesis" : "Explore"}
      </Link>
    </div>
  );
}
