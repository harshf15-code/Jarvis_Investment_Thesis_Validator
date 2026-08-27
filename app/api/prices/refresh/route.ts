import { NextRequest, NextResponse } from "next/server";

import { getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * On-demand price refresh for a set of stocks, called on page load and the
 * "Refresh Prices" button (spec's global Price Data rule: no background
 * polling while a page is open). Bypasses the `poll-prices` Edge Function's
 * cron cache and hits Yahoo directly so a page load always shows a genuinely
 * fresh price, not a possibly-stale cron snapshot.
 */
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

  const supabase = createAdminClient();
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("id, yahoo_symbol")
    .in("id", stockIds as string[]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const prices: Record<string, { price: number; asOf: string }> = {};

  await Promise.all(
    (stocks ?? []).map(async (stock) => {
      try {
        const quote = await getQuote(stock.yahoo_symbol);
        prices[stock.id] = { price: quote.price, asOf: quote.asOf.toISOString() };
        await supabase
          .from("stocks")
          .update({ last_price: quote.price, last_price_at: quote.asOf.toISOString() })
          .eq("id", stock.id);
      } catch {
        // One symbol failing (delisted, rate-limited, transient network
        // error) must not fail the whole batch — that stock's price simply
        // stays at its last known value and is omitted from `prices`, and
        // the spec's "Price unavailable" badge (Task 6's empty/error state
        // helper) is what renders for it.
      }
    }),
  );

  return NextResponse.json({ prices });
}
