import { CockpitClient } from "@/components/cockpit/cockpit-client";
import { pageScope } from "@/lib/portfolio/active";

/**
 * Screen HUB-1 — the Cockpit. The app's front door.
 *
 * A thin server wrapper around the client screen, for one reason: the active
 * book has to be resolvable before anything renders, and a bare `/dashboard`
 * has to land on a NAMED book rather than on whatever the browser happened to
 * remember. `pageScope` redirects to the default, so the URL always says which
 * book is on screen — the same contract as `/positions` and `/scratchpad`.
 */
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CockpitPage({ searchParams }: PageProps) {
  const { scope } = await pageScope("/dashboard", searchParams);
  return <CockpitClient scopeParam={scope.mode === "all" ? "all" : scope.id} />;
}
