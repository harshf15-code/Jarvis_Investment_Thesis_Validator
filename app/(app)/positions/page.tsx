import { EmptyState } from "@/components/shared/empty-state";
import { PositionsPageClient } from "@/components/positions/positions-page-client";
import type { PositionRow } from "@/components/positions/positions-table";
import { listOpenPositions } from "@/lib/queries";

export default async function PositionsPage() {
  const rows: PositionRow[] = await listOpenPositions();

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Active Positions & Exit Discipline</h1>
      {rows.length === 0 ? (
        <EmptyState title="No active positions." description="Start with a thesis →" />
      ) : (
        <PositionsPageClient rows={rows} />
      )}
    </div>
  );
}
