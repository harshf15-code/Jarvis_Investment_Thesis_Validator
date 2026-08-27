import { EmptyState } from "@/components/shared/empty-state";
import { JournalArchiveTable } from "@/components/journal/journal-archive-table";
import { fetchInternalApi } from "@/lib/server-fetch";

export default async function JournalArchivePage() {
  const res = await fetchInternalApi("/api/journal");
  const body = await res.json();
  const entries = body.entries ?? [];

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Trade Journal</h1>
      {entries.length === 0 ? (
        <EmptyState title="No journal entries yet." description="Exit a position to write your first review →" />
      ) : (
        <JournalArchiveTable entries={entries} />
      )}
    </div>
  );
}
