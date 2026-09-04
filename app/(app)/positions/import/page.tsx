import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ImportWizard } from "@/components/positions/import/import-wizard";
import { pageScope, scopeParam } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";

/** Reads the live database on every request — see `app/(app)/positions/page.tsx`. */
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ImportHoldingsPage({ searchParams }: PageProps) {
  const { scope, active } = await pageScope("/positions/import", searchParams);

  // The objective is asked once PER BOOK, and only if that book has never
  // answered. A trader importing their second CSV into the same portfolio
  // should not be asked what it is for again — but a second portfolio is a
  // second question, because the whole point of asking is that the answer
  // differs between books.
  //
  // Every book's answer, not just the one in the URL. The wizard's first step
  // lets the trader import into a DIFFERENT book than the one they arrived on,
  // and reading only the active book's profile got it wrong in both directions:
  // it hid the question for a book that had never answered it, and asked a book
  // that had — then submitted the reply, overwriting a real objective with an
  // answer to a question that should not have been on screen. At most five
  // short rows, so this costs one query either way.
  const supabase = await createClient();
  const { data: profiles, error: profilesError } = await supabase
    .from("portfolio_profiles")
    .select("portfolio_id, objective");
  // Thrown, not defaulted. An empty list here does not read as "could not
  // check" — it reads as "no book has an objective", so the wizard would show
  // the question to a book that has already answered it and then SUBMIT the
  // reply, overwriting a real objective. Failing the screen is recoverable;
  // silently replacing the sentence that every Council verdict is judged
  // against is not. Reaches the nearest error.tsx, like `pageScope`.
  if (profilesError) throw new Error("Could not read your portfolios' objectives.");
  const booksWithObjective = (profiles ?? [])
    .filter((p) => p.objective != null)
    .map((p) => p.portfolio_id);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/positions?portfolio=${scopeParam(scope)}`}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
      >
        <ArrowLeft className="size-3.5" />
        Active Positions
      </Link>
      <h1 className="font-display text-2xl text-on-surface">
        Import Holdings{active ? ` into ${active.name}` : ""}
      </h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-on-surface-variant">
        Bring in stocks you already own. They land beside your Jarvis positions everywhere — the
        Cockpit, this table, the Journal — but they arrive without a trade plan, because no analysis
        produced one.
      </p>
      <ImportWizard booksWithObjective={booksWithObjective} />
    </div>
  );
}
