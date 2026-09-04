import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PortfolioCouncilClient } from "@/components/portfolio/council/portfolio-council-client";
import { pageScope } from "@/lib/portfolio/active";
import { listOpenPositions } from "@/lib/queries";

/**
 * The Council on the whole book. Reads the live database on every request —
 * see the note on `/positions`.
 */
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PortfolioCouncilPage({ searchParams }: PageProps) {
  const { scope, active } = await pageScope("/positions/council", searchParams);
  const rows = await listOpenPositions(scope);
  // Quantity per ticker, aggregated across separate theses in the same name —
  // the same collapse the consult itself does. Quantities and not just tickers,
  // because trimming a position changes every weight in its sub-book and a
  // stored report should say so rather than reading as current.

  const currentQuantities = new Map<string, number>();
  for (const row of rows) {
    const ticker = row.position.ticker.toUpperCase();
    currentQuantities.set(ticker, (currentQuantities.get(ticker) ?? 0) + remainingOf(row));
  }

  return (
    <div>
      <Link
        href="/positions"
        className="mb-4 inline-flex items-center gap-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft className="size-3.5" />
        Active Positions
      </Link>
      <h1 className="font-display text-2xl text-on-surface">
        The Council on {active ? active.name : "your portfolio"}
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm text-on-surface-variant">
        The same roster you use on a thesis, asked a different question: not whether to own one
        stock, but whether this collection of things makes sense together.
      </p>
      <div className="mt-6">
        <PortfolioCouncilClient
          currentQuantities={currentQuantities}
          positionCount={rows.length}
          portfolio={active}
        />
      </div>
    </div>
  );
}

/** Shares still held: everything entered, less everything exited. */
function remainingOf(row: Awaited<ReturnType<typeof listOpenPositions>>[number]): number {
  return row.weightedAverage.totalQuantity - (row.exitedQuantity ?? 0);
}
