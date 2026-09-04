import { ScratchpadClient } from "@/components/scratchpad/scratchpad-client";
import { pageScope } from "@/lib/portfolio/active";
import { listOpenPositions } from "@/lib/queries";

/**
 * The Scratchpad. Reads the live database on every request — see `/positions`.
 */
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ScratchpadPage({ searchParams }: PageProps) {
  const { scope, active } = await pageScope("/scratchpad", searchParams);
  const rows = await listOpenPositions(scope);
  // Distinct tickers, not positions: two holdings in the same name are one
  // holding as far as a pattern goes, and this has to agree with the route's
  // own minimum or the button lies about what will happen.
  const heldTickers = [...new Set(rows.map((r) => r.position.ticker.toUpperCase()))].sort();

  return (
    <div>
      <h1 className="font-display text-2xl text-on-surface">Scratchpad</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-on-surface-variant">
        Somewhere to put an idea before it is a thesis, next to Jarvis&rsquo;s read on what the
        things you already own say about how you pick.
      </p>
      <div className="mt-6">
        <ScratchpadClient heldTickers={heldTickers} portfolio={active} />
      </div>
    </div>
  );
}
