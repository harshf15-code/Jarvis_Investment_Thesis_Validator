import { EmptyState } from "@/components/shared/empty-state";
import { PositionsTable, type PositionRow } from "@/components/positions/positions-table";

async function fetchPositions(): Promise<PositionRow[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/positions`, {
    cache: "no-store",
  });
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
        <PositionsTable rows={rows} />
      )}
    </div>
  );
}
