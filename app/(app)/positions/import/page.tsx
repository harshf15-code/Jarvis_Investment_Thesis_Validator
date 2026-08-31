import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ImportWizard } from "@/components/positions/import/import-wizard";
import { createClient } from "@/lib/supabase/server";

/** Reads the live database on every request — see `app/(app)/positions/page.tsx`. */
export const dynamic = "force-dynamic";

export default async function ImportHoldingsPage() {
  // The objective is asked once, and only if it has never been answered. A
  // trader importing their second CSV should not be asked what their portfolio
  // is for again.
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("portfolio_profiles")
    .select("objective")
    .maybeSingle();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/positions"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
      >
        <ArrowLeft className="size-3.5" />
        Active Positions
      </Link>
      <h1 className="font-display text-2xl text-on-surface">Import Holdings</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-on-surface-variant">
        Bring in stocks you already own. They land beside your Jarvis positions everywhere — the
        Cockpit, this table, the Journal — but they arrive without a trade plan, because no analysis
        produced one.
      </p>
      <ImportWizard hasObjective={profile?.objective != null} />
    </div>
  );
}
