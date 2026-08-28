import { EmptyState } from "@/components/shared/empty-state";
import { RecommendationStats } from "@/components/recommendations/recommendation-stats";
import { RecommendationsTable } from "@/components/recommendations/recommendations-table";
import { listRecommendations } from "@/lib/queries";

/**
 * Never prerendered: this reads the live database on every request. Next used
 * to infer that from the `cookies()` call inside the old self-fetch helper;
 * querying Supabase directly is not a dynamic signal, so the intent has to be
 * stated. Without it the build tries to render this page and fails wherever
 * the Supabase env vars are absent (CI), or bakes in stale rows where they
 * are present.
 */
export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const rows = await listRecommendations();

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-on-surface">Jarvis Recommendation Tracker</h1>
      {rows.length === 0 ? (
        <EmptyState title="No Jarvis recommendations yet." description="Build a trade plan to start tracking." />
      ) : (
        <>
          <RecommendationStats rows={rows} />
          <RecommendationsTable rows={rows} />
        </>
      )}
    </div>
  );
}
