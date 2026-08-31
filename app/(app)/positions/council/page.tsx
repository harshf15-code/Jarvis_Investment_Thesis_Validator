import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PortfolioCouncilClient } from "@/components/portfolio/council/portfolio-council-client";
import { listOpenPositions } from "@/lib/queries";

/**
 * The Council on the whole book. Reads the live database on every request —
 * see the note on `/positions`.
 */
export const dynamic = "force-dynamic";

export default async function PortfolioCouncilPage() {
  const rows = await listOpenPositions();
  // De-duplicated: two open positions can sit on the same ticker via separate
  // theses, and the per-holding table should show one row per holding.
  const heldTickers = [...new Set(rows.map((r) => r.position.ticker))].sort();

  return (
    <div>
      <Link
        href="/positions"
        className="mb-4 inline-flex items-center gap-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft className="size-3.5" />
        Active Positions
      </Link>
      <h1 className="font-display text-2xl text-on-surface">The Council on your portfolio</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-on-surface-variant">
        The same roster you use on a thesis, asked a different question: not whether to own one
        stock, but whether this collection of things makes sense together.
      </p>
      <div className="mt-6">
        <PortfolioCouncilClient heldTickers={heldTickers} positionCount={rows.length} />
      </div>
    </div>
  );
}
