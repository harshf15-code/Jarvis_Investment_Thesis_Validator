import { ThesisInputForm } from "@/components/thesis/thesis-input-form";

export default async function NewThesisPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-display text-2xl text-on-surface">New Thesis</h1>
      <ThesisInputForm prefillTicker={ticker} />
    </div>
  );
}
