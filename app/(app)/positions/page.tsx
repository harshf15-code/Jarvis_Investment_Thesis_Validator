import Link from "next/link";
import { Upload, Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PositionsPageClient } from "@/components/positions/positions-page-client";
import type { PositionRow } from "@/components/positions/positions-table";
import { pageScope } from "@/lib/portfolio/active";
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

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PositionsPage({ searchParams }: PageProps) {
  // A bare /positions redirects to the default book, so the URL always names
  // what is on screen. See `pageScope`.
  const { scope, portfolios, active } = await pageScope("/positions", searchParams);
  const rows: PositionRow[] = await listOpenPositions(scope);

  // Only in the roll-up. With one book on screen the book is the heading, and a
  // badge on every row would repeat it; across books it is the difference
  // between two otherwise identical rows on the same ticker.
  const books =
    scope.mode === "all"
      ? new Map(portfolios.map((p) => [p.id, { name: p.name, ownership: p.ownership }]))
      : undefined;

  return (
    <div>
      {/* The import link lives here rather than inside PositionsPageClient
          because the empty branch below skips that component entirely — which
          would hide "Import Holdings" from exactly the trader who has nothing
          in Jarvis yet and most needs it. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-on-surface">Active Positions &amp; Exit Discipline</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Only offered once there is a book to judge. The Council reviews
              construction, and one position has none — the route refuses it,
              and a button that always 400s is worse than no button. */}
          {rows.length >= 2 && active && (
            <Link
              href={`/positions/council?portfolio=${active.id}`}
              className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-white/25 hover:text-on-surface"
            >
              <Users className="size-3.5" />
              Consult the Council
            </Link>
          )}
          <Link
            href={active ? `/positions/import?portfolio=${active.id}` : "/positions/import"}
            className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-white/25 hover:text-on-surface"
          >
            <Upload className="size-3.5" />
            Import Holdings
          </Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No active positions."
          description="Start with a thesis, or import the holdings you already own from a broker CSV."
          action={
            <Link
              href={active ? `/positions/import?portfolio=${active.id}` : "/positions/import"}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-colors hover:bg-primary-dim"
            >
              Import Holdings
            </Link>
          }
        />
      ) : (
        <PositionsPageClient rows={rows} books={books} />
      )}
    </div>
  );
}
