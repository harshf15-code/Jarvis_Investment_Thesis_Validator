import { notFound } from "next/navigation";

import { CockpitClient } from "@/components/cockpit/cockpit-client";
import { readCockpit } from "@/lib/cockpit";
import { pageScope } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";

/**
 * Screen HUB-1 — the Cockpit. The app's front door.
 *
 * Two things happen here before anything renders. The active book has to be
 * resolvable, because a bare `/dashboard` must land on a NAMED book rather than
 * on whatever the browser happened to remember — `pageScope` redirects to the
 * default, so the URL always says which book is on screen, the same contract as
 * `/positions` and `/scratchpad`. And the numbers are READ HERE, not fetched by
 * the browser after hydration: this render is already on the server holding a
 * Supabase client, and `lib/queries.ts` explains at length why it should use it.
 */
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CockpitPage({ searchParams }: PageProps) {
  const { scope } = await pageScope("/dashboard", searchParams);

  const supabase = await createClient();
  const cockpit = await readCockpit(supabase, scope);
  // `pageScope` has already replaced an unknown book with the default, so this
  // is the narrow race where a book was deleted between the two reads.
  if (!cockpit) notFound();

  return (
    <CockpitClient data={cockpit} scopeParam={scope.mode === "all" ? "all" : scope.id} />
  );
}
