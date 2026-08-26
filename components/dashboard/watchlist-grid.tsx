import Link from "next/link";

import { StockCard, type StockWithHolding } from "@/components/dashboard/stock-card";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Holding } from "@/lib/types";

/**
 * Server component: reads directly via `lib/supabase/admin.ts` rather than
 * round-tripping through `GET /api/stocks` over `fetch`, per the brief and
 * Task 3's "server code uses the admin client" convention. The two-query
 * app-level join (`stocks` then `holdings`) mirrors
 * `app/api/stocks/route.ts`'s `GET` handler exactly, for the same reason
 * documented there: the hand-written `Database` type has no `Relationships`
 * metadata for a PostgREST embedded `select("*, holdings(*)")`.
 */
export async function WatchlistGrid() {
  const supabase = createAdminClient();

  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (stocksError) {
    // No live DB to render against in this task; surface a real error state
    // rather than crashing the page, matching this route's other failure
    // handling (`app/api/stocks/route.ts` returns 500 + a message on the
    // same query, rather than throwing).
    return (
      <EmptyOrErrorState
        title="Couldn't load your watchlist"
        description={stocksError.message}
      />
    );
  }

  // `stocks` is `null` only alongside a truthy `stocksError` above per
  // supabase-js's contract, but this stays safe (empty array, not a thrown
  // error) if that contract is ever violated.
  const stockRows = stocks ?? [];

  if (stockRows.length === 0) {
    return (
      <EmptyOrErrorState
        title="Your watchlist is empty"
        description="Add a ticker to start tracking it, or record it as a holding to see live P&L."
        showCta
      />
    );
  }

  const stockIds = stockRows.map((stock) => stock.id);

  let holdingsByStockId = new Map<string, Holding>();
  const { data: holdings, error: holdingsError } = await supabase
    .from("holdings")
    .select("*")
    .in("stock_id", stockIds);

  if (holdingsError) {
    return (
      <EmptyOrErrorState
        title="Couldn't load your holdings"
        description={holdingsError.message}
      />
    );
  }

  holdingsByStockId = new Map(
    (holdings ?? []).map((holding) => [holding.stock_id, holding]),
  );

  const stocksWithHoldings: StockWithHolding[] = stockRows.map((stock) => ({
    ...stock,
    holding: holdingsByStockId.get(stock.id) ?? null,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stocksWithHoldings.map((stock) => (
        <StockCard key={stock.id} stock={stock} />
      ))}
    </div>
  );
}

function EmptyOrErrorState({
  title,
  description,
  showCta = false,
}: {
  title: string;
  description: string;
  showCta?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl bg-surface-container-low px-6 py-16 text-center">
      <h2 className="font-display text-xl font-semibold text-on-surface">
        {title}
      </h2>
      <p className="max-w-sm text-sm text-on-surface/60">{description}</p>
      {showCta ? (
        <Link
          href="/add"
          className="mt-2 inline-flex h-11 items-center rounded-xl bg-gradient-to-br from-primary to-primary-container px-5 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          Add a stock
        </Link>
      ) : null}
    </div>
  );
}
