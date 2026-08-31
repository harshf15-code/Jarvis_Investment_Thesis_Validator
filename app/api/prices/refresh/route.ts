import { NextRequest, NextResponse } from "next/server";

import { MAX_CONCURRENT_QUOTES, mapWithConcurrency } from "@/lib/concurrency";
import { getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * On-demand price refresh for a set of stocks, called on page load and the
 * "Refresh Prices" button (spec's global Price Data rule: no background
 * polling while a page is open). Bypasses the `poll-prices` Edge Function's
 * cron cache and hits Yahoo directly so a page load always shows a genuinely
 * fresh price, not a possibly-stale cron snapshot.
 *
 * Both bounds below matter: the handler turns one request into one outbound
 * Yahoo fetch per id (each retrying up to 3 times) plus a database write, so
 * without them a caller could post ten thousand ids and have this app make tens
 * of thousands of outbound requests on their behalf.
 */

/** Refusing is better than silently truncating — the caller learns it asked for too much. */
const MAX_STOCK_IDS = 50;

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const stockIds: unknown = json?.stockIds;
  if (!Array.isArray(stockIds) || stockIds.some((id) => typeof id !== "string")) {
    return NextResponse.json(
      { error: "Body must be { stockIds: string[] }" },
      { status: 400 },
    );
  }
  if (stockIds.length === 0) {
    return NextResponse.json({ prices: {} });
  }
  if (stockIds.length > MAX_STOCK_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_STOCK_IDS} stockIds per request` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("id, yahoo_symbol")
    .in("id", stockIds as string[]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // `currency` rides along because the refresh is the path that CORRECTS a
  // row seeded from `exchange` (0021). A caller holding a stale currency would
  // otherwise keep rendering the old one until a full reload.
  const prices: Record<string, { price: number; asOf: string; currency: string | null }> = {};
  // `stocks` is a shared cache that `authenticated` may read but not write
  // (0014), so the price write-back is service-role work.
  const stocksAdmin = createAdminClient();

  await mapWithConcurrency(stocks ?? [], MAX_CONCURRENT_QUOTES, async (stock) => {
    try {
      const quote = await getQuote(stock.yahoo_symbol);
      prices[stock.id] = {
        price: quote.price,
        asOf: quote.asOf.toISOString(),
        currency: quote.currency,
      };
      await stocksAdmin
        .from("stocks")
        .update({
          last_price: quote.price,
          last_price_at: quote.asOf.toISOString(),
          // Currency is re-asserted from the quote on every refresh, not
          // written once and trusted forever. 0021 backfilled it from
          // `exchange`, which is a good guess and not a fact: a bare US ticker
          // can resolve to a foreign listing, and a row that was seeded USD
          // would otherwise be aggregated as dollars for the rest of time. The
          // quote is the authority, and this is the path that keeps saying so.
          ...(quote.currency ? { currency: quote.currency } : {}),
        })
        .eq("id", stock.id);
    } catch {
      // One symbol failing (delisted, rate-limited, transient network error)
      // must not fail the whole batch — that stock's price simply stays at its
      // last known value and is omitted from `prices`, and the spec's "Price
      // unavailable" badge (Task 6's empty/error state helper) renders for it.
    }
  });

  return NextResponse.json({ prices });
}
