import { EmptyState } from "@/components/shared/empty-state";
import { ThesisList } from "@/components/thesis/thesis-list";
import { fetchInternalApi } from "@/lib/server-fetch";

/** Screen HUB-3's thesis list — the canonical "view any thesis" destination (see Task 21's Produces note). */
export default async function ThesisListPage() {
  const res = await fetchInternalApi("/api/theses");
  const body = await res.json();
  const rows = body.theses ?? [];

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Stress Test &amp; Trade Plan</h1>
      {rows.length === 0 ? (
        <EmptyState title="No theses yet." description="Start with a thesis →" />
      ) : (
        <ThesisList rows={rows} />
      )}
    </div>
  );
}
