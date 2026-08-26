import { NextRequest, NextResponse } from "next/server";

import { getQuote, MarketDataError, resolveYahooSymbol } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Holding, HoldingInsert, StockInsert } from "@/lib/types";
import { AddTickerInputSchema } from "@/lib/validation/schemas";

/** Postgres unique_violation error code, returned by postgrest-js as `error.code`. */
const UNIQUE_VIOLATION = "23505";

/**
 * POST /api/stocks — add a ticker to the watchlist, or as a holding.
 *
 * Fails fast on a bad ticker: `getQuote()` is called *before* any insert, so
 * a typo never creates a row at all. If `type === "holding"`, the `stocks`
 * and `holdings` rows are inserted as two separate statements (no
 * multi-statement transaction helper is available without a Postgres
 * function) — if the second insert fails, the just-created `stocks` row is
 * deleted for real (not soft-deleted) before returning an error, since it
 * was never a complete, user-visible entry to begin with.
 */
export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AddTickerInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const ticker = input.ticker.toUpperCase();
  const yahooSymbol = resolveYahooSymbol(ticker, input.exchange);

  let quote: { price: number; asOf: Date };
  try {
    quote = await getQuote(yahooSymbol);
  } catch (err) {
    if (err instanceof MarketDataError) {
      return NextResponse.json(
        {
          error: `Could not find a quote for "${ticker}" on ${input.exchange}. Check the ticker and try again.`,
          field: "ticker",
        },
        { status: 422 },
      );
    }
    throw err;
  }

  const supabase = createAdminClient();

  const stockInsert: StockInsert = {
    ticker,
    yahoo_symbol: yahooSymbol,
    exchange: input.exchange,
    type: input.type,
    last_price: quote.price,
    last_price_at: quote.asOf.toISOString(),
  };

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .insert(stockInsert)
    .select("*")
    .single();

  if (stockError || !stock) {
    if (stockError?.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: `${ticker} on ${input.exchange} is already being tracked.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: stockError?.message ?? "Failed to create stock" },
      { status: 500 },
    );
  }

  if (input.type !== "holding") {
    return NextResponse.json({ ...stock, holding: null }, { status: 201 });
  }

  const holdingInsert: HoldingInsert = {
    stock_id: stock.id,
    shares: input.shares,
    cost_basis: input.cost_basis,
    date_acquired: input.date_acquired,
  };

  const { data: holding, error: holdingError } = await supabase
    .from("holdings")
    .insert(holdingInsert)
    .select("*")
    .single();

  if (holdingError || !holding) {
    // Orphan cleanup: this `stocks` row exists only because of this request
    // and has no other references yet, so a real delete (not soft-delete)
    // is correct — this undoes a failed multi-step insert rather than
    // removing a user-visible watchlist entry.
    await supabase.from("stocks").delete().eq("id", stock.id);

    return NextResponse.json(
      {
        error:
          holdingError?.message ??
          "Failed to save holding details; the stock entry was rolled back.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ...stock, holding }, { status: 201 });
}

/**
 * GET /api/stocks — list all non-deleted stocks, each with its `holdings`
 * row attached (`null` for watchlist-only entries). Ordered newest first.
 *
 * Fetches `stocks` and `holdings` as two separate queries and joins them in
 * application code, rather than a PostgREST embedded-resource select,
 * since the hand-written `Database` type (`lib/types.ts`) doesn't carry
 * `Relationships` metadata for supabase-js to type an embedded `holdings(*)`
 * select against.
 */
export async function GET() {
  const supabase = createAdminClient();

  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (stocksError) {
    return NextResponse.json({ error: stocksError.message }, { status: 500 });
  }

  const stockIds = (stocks ?? []).map((stock) => stock.id);

  let holdingsByStockId = new Map<string, Holding>();
  if (stockIds.length > 0) {
    const { data: holdings, error: holdingsError } = await supabase
      .from("holdings")
      .select("*")
      .in("stock_id", stockIds);

    if (holdingsError) {
      return NextResponse.json({ error: holdingsError.message }, { status: 500 });
    }

    holdingsByStockId = new Map(
      (holdings ?? []).map((holding) => [holding.stock_id, holding]),
    );
  }

  const result = (stocks ?? []).map((stock) => ({
    ...stock,
    holding: holdingsByStockId.get(stock.id) ?? null,
  }));

  return NextResponse.json(result);
}
