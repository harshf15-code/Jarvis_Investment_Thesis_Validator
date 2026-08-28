import { EmptyState } from "@/components/shared/empty-state";
import { JournalArchiveTable } from "@/components/journal/journal-archive-table";
import { listJournalEntries } from "@/lib/queries";

/**
 * Never prerendered: this reads the live database on every request. Next used
 * to infer that from the `cookies()` call inside the old self-fetch helper;
 * querying Supabase directly is not a dynamic signal, so the intent has to be
 * stated. Without it the build tries to render this page and fails wherever
 * the Supabase env vars are absent (CI), or bakes in stale rows where they
 * are present.
 */
export const dynamic = "force-dynamic";

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
