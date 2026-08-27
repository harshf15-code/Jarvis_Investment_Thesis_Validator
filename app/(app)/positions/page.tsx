import { EmptyState } from "@/components/shared/empty-state";
import { PositionsPageClient } from "@/components/positions/positions-page-client";
import type { PositionRow } from "@/components/positions/positions-table";
import { fetchInternalApi } from "@/lib/server-fetch";

async function fetchPositions(): Promise<PositionRow[]> {
  const res = await fetchInternalApi("/api/positions");
  const body = await res.json();
  return body.positions ?? [];
}

export default async function PositionsPage() {
  const rows = await fetchPositions();

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
