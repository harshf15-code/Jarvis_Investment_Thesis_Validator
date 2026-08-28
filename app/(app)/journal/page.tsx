import { EmptyState } from "@/components/shared/empty-state";
import { JournalArchiveTable } from "@/components/journal/journal-archive-table";
import { listJournalEntries } from "@/lib/queries";

export default async function JournalArchivePage() {
  const entries = await listJournalEntries();

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
