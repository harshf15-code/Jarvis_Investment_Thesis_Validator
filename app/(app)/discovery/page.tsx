import { DiscoveryScreen } from "@/components/discovery/discovery-screen";
import { readOpportunities } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Screen 7 — Opportunity Discovery (US-20/US-21).
 *
 * Reads its own rows rather than shipping a skeleton and asking the browser to
 * fetch them back — see `lib/queries.ts` for the full argument.
 */
export const dynamic = "force-dynamic";

export default async function DiscoveryPage() {
  const supabase = await createClient();
  const rows = await readOpportunities(supabase);

  return <DiscoveryScreen rows={rows} />;
}
