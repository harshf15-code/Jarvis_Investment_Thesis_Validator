import { JournalReviewForm } from "@/components/journal/journal-review-form";

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ positionId?: string }>;
}) {
  const { positionId } = await searchParams;
  if (!positionId) {
    return <p className="text-sm text-on-surface/60">Missing positionId.</p>;
  }
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-display text-2xl text-on-surface">Trade Journal & Review</h1>
      <JournalReviewForm positionId={positionId} />
    </div>
  );
}
