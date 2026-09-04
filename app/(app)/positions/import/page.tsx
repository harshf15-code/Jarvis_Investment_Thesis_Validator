import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ImportWizard } from "@/components/positions/import/import-wizard";
import { pageScope } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";

/** Reads the live database on every request — see `app/(app)/positions/page.tsx`. */
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ImportHoldingsPage({ searchParams }: PageProps) {
  const { active } = await pageScope("/positions/import", searchParams);

  // The objective is asked once PER BOOK, and only if that book has never
  // answered. A trader importing their second CSV into the same portfolio
  // should not be asked what it is for again — but a second portfolio is a
  // second question, because the whole point of asking is that the answer
  // differs between books.
  const supabase = await createClient();
  const { data: profile } = active
    ? await supabase
        .from("portfolio_profiles")
        .select("objective")
        .eq("portfolio_id", active.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/positions"
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
      <ImportWizard hasObjective={profile?.objective != null} />
    </div>
  );
}
