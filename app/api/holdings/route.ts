import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { cryptoStockKey, getCryptoPrices } from "@/lib/crypto-data";
import { buildHoldingRows } from "@/lib/portfolio/create-holding";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Adds ONE crypto holding by hand.
 *
 * The CSV import is the bulk path; this is the single-coin one, and without it
 * logging one BTC buy would mean writing a spreadsheet. Both build their rows
 * with `buildHoldingRows`, so a holding is a holding however it arrived.
 *
 * Deliberately crypto-only. An equity added by hand would need a Yahoo
 * resolution step, an exchange choice and a duplicate check against the book —
 * all of which the import already does properly — and this route would become a
 * worse copy of it.
 */
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  portfolio_id: z.string().uuid("Choose which portfolio this holding belongs to."),
  coingecko_id: z.string().min(1),
  quantity: z.coerce.number().positive("Quantity must be more than zero."),
  price: z.coerce.number().positive("Price must be more than zero."),
  date: z.string().date(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const supabase = await createClient();

  // The book decides the currency, so it has to exist before anything else can
  // be decided. RLS hides another trader's row rather than erroring, so a
  // missing row is a 404 — the same answer, and for the same reason.
  const { data: book, error: bookError } = await supabase
    .from("portfolios")
    .select("id, base_currency")
    .eq("id", input.portfolio_id)
    .maybeSingle();
  if (bookError) return NextResponse.json({ error: bookError.message }, { status: 500 });
  if (!book) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  // Only coins in the tracked universe. This is the check that stops the defect
  // the whole feature exists to remove: a free-text ticker like "BTC" resolving
  // on Yahoo to a US-listed Bitcoin trust — the wrong asset, with no error.
  const { data: coin, error: coinError } = await supabase
    .from("crypto_universe")
    .select("coingecko_id, symbol, name")
    .eq("coingecko_id", input.coingecko_id)
    .maybeSingle();
  if (coinError) return NextResponse.json({ error: coinError.message }, { status: 500 });
  if (!coin) {
    return NextResponse.json(
      { error: "That coin is not one of the tracked top ten." },
      { status: 400 },
    );
  }

  const currency = book.base_currency;

  // Best-effort: a holding is worth recording even if CoinGecko is down. A null
  // `last_price` renders as "Price unavailable" and the next hourly poll fills
  // it in — losing the holding over a third party's outage would be worse.
  let lastPrice: number | null = null;
  let lastPriceAt: string | null = null;
  try {
    const quote = (await getCryptoPrices([coin.coingecko_id], currency)).get(coin.coingecko_id);
    if (quote) {
      lastPrice = quote.price;
      lastPriceAt = quote.asOf.toISOString();
    }
  } catch {
    // Deliberately swallowed — see above.
  }

  // Shared market data: `authenticated` reads it, service-role maintains it
  // (0014). Upsert on the same unique `yahoo_symbol` index the import uses;
  // `cryptoStockKey` is what makes that index work for a coin.
  const { data: stock, error: stockError } = await createAdminClient()
    .from("stocks")
    .upsert(
      {
        ticker: coin.symbol,
        yahoo_symbol: cryptoStockKey(coin.coingecko_id, currency),
        coingecko_id: coin.coingecko_id,
        asset_class: "crypto",
        exchange: "CRYPTO",
        currency,
        last_price: lastPrice,
        last_price_at: lastPriceAt,
      },
      { onConflict: "yahoo_symbol" },
    )
    .select("id")
    .single();
  if (stockError || !stock) {
    return NextResponse.json(
      { error: stockError?.message ?? "Could not record that coin." },
      { status: 500 },
    );
  }

  const rows = buildHoldingRows(
    [
      {
        ticker: coin.symbol,
        stockId: stock.id,
        quantity: input.quantity,
        price: input.price,
        date: input.date,
        entryNote: "Added by hand.",
        assetClass: "crypto",
      },
    ],
    { portfolioId: input.portfolio_id, market: "CRYPTO", importBatchId: null },
  );

  // Same order and same rollback as the import: everything cascades from
  // `theses`, so deleting them unwinds a half-written holding completely.
  const undo = async (message: string) => {
    await supabase
      .from("theses")
      .delete()
      .in("id", rows.theses.map((t) => t.id!));
    return NextResponse.json({ error: message }, { status: 500 });
  };

  for (const [table, payload] of [
    ["theses", rows.theses],
    ["trade_plans", rows.tradePlans],
    ["positions", rows.positions],
    ["entries", rows.entries],
  ] as const) {
    const { error } = await supabase.from(table).insert(payload as never);
    if (error) return undo(error.message);
  }

  return NextResponse.json({ position: rows.positions[0] }, { status: 201 });
}
