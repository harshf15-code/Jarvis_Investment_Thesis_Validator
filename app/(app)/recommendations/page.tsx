import { EmptyState } from "@/components/shared/empty-state";
import { RecommendationStats } from "@/components/recommendations/recommendation-stats";
import { RecommendationsTable } from "@/components/recommendations/recommendations-table";
import { listRecommendations } from "@/lib/queries";

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
