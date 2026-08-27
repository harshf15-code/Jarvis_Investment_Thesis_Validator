import { EmptyState } from "@/components/shared/empty-state";
import { RecommendationStats } from "@/components/recommendations/recommendation-stats";
import { RecommendationsTable } from "@/components/recommendations/recommendations-table";

async function fetchRecommendations() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/recommendations`, { cache: "no-store" });
  const body = await res.json();
  return body.recommendations ?? [];
}

export default async function RecommendationsPage() {
  const rows = await fetchRecommendations();

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
