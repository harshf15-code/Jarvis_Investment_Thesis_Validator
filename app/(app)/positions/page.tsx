import Link from "next/link";
import { Upload } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PositionsPageClient } from "@/components/positions/positions-page-client";
import type { PositionRow } from "@/components/positions/positions-table";
import { listOpenPositions } from "@/lib/queries";

/**
 * Never prerendered: this reads the live database on every request. Next used
 * to infer that from the `cookies()` call inside the old self-fetch helper;
 * querying Supabase directly is not a dynamic signal, so the intent has to be
 * stated. Without it the build tries to render this page and fails wherever
 * the Supabase env vars are absent (CI), or bakes in stale rows where they
 * are present.
 */
export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const rows: PositionRow[] = await listOpenPositions();

  return (
    <div>
      {/* The import link lives here rather than inside PositionsPageClient
          because the empty branch below skips that component entirely — which
          would hide "Import Holdings" from exactly the trader who has nothing
          in Jarvis yet and most needs it. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-on-surface">Active Positions &amp; Exit Discipline</h1>
        <Link
          href="/positions/import"
          className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-white/25 hover:text-on-surface"
        >
          <Upload className="size-3.5" />
          Import Holdings
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No active positions."
          description="Start with a thesis, or import the holdings you already own from a broker CSV."
          action={
            <Link
              href="/positions/import"
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-colors hover:bg-primary-dim"
            >
              Import Holdings
            </Link>
          }
        />
      ) : (
        <PositionsPageClient rows={rows} />
      )}
    </div>
  );
}
