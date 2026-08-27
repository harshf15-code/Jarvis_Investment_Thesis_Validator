"use client";

import { useRouter } from "next/navigation";

import { computeDistanceToStop } from "@/lib/position-metrics";
import { DisciplineBanner } from "./discipline-banner";
import { PositionsTable, type PositionRow } from "./positions-table";

/**
 * US-04's HUB-2 half: the list's own discipline banner, for whichever open
 * position sits closest to (or through) its stop. Client-side because the
 * banner's buttons navigate, which a server component can't do.
 *
 * `t1Trimmed` is hardcoded `false`: `GET /api/positions` (Task 13) doesn't
 * join each row's `exits` — only `GET /api/positions/:id` does — so the
 * banner re-evaluates with real exit data once the user is on the position's
 * own page. A stale `false` here means this list-level banner never says
 * "already trimmed" and always offers the trim action: a redundant offer, not
 * a missed alert.
 */
export function PositionsPageClient({ rows }: { rows: PositionRow[] }) {
  const router = useRouter();

  const ranked: { row: PositionRow; rupeesToStop: number }[] = [];
  for (const row of rows) {
    const price = row.stock?.last_price;
    if (price == null) continue;
    const distance = computeDistanceToStop({ currentPrice: price, stopLoss: row.tradePlan?.stop_loss ?? null });
    if (distance === null) continue;
    ranked.push({ row, rupeesToStop: distance.rupees });
  }
  ranked.sort((a, b) => a.rupeesToStop - b.rupeesToStop);
  const mostUrgent = ranked[0]?.row;

  return (
    <>
      {mostUrgent && (
        <DisciplineBanner
          ticker={mostUrgent.position.ticker}
          currentPrice={mostUrgent.stock?.last_price ?? null}
          exchange={mostUrgent.stock?.exchange ?? "US"}
          stopLoss={mostUrgent.tradePlan?.stop_loss ?? null}
          target1={mostUrgent.tradePlan?.target_1 ?? null}
          t1Trimmed={false}
          onExitNow={() => router.push(`/positions/${mostUrgent.position.id}`)}
          onLogTrim={() => router.push(`/positions/${mostUrgent.position.id}`)}
        />
      )}
      <PositionsTable rows={rows} />
    </>
  );
}
