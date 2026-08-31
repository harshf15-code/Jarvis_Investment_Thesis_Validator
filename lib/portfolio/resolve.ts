import { MAX_CONCURRENT_QUOTES, mapWithConcurrency } from "@/lib/concurrency";
import { getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { exchangesFor } from "@/lib/markets";
import {
  repeatedTickerIndices,
  rowValidationError,
  type DraftImportRow,
  type ResolvedImportRow,
} from "@/lib/portfolio-import";
import { createClient } from "@/lib/supabase/server";
import type { MarketCode } from "@/lib/types";

/**
 * Prices and vets a batch of draft CSV rows. Writes nothing.
 *
 * Both import routes run this: `/api/portfolio/resolve` to build the preview,
 * and `/api/portfolio/imports` again at commit time. The second run is not
 * redundant — the client's preview is a courtesy, and letting a browser hand
 * back the `stock_id` it wants a position pointed at would make the whole
 * resolution step advisory.
 */

type UserClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A row's outcome, worst first. `invalid` beats `unresolved` beats
 * `duplicate`: a trader whose row is both unpriceable and a repeat needs to
 * hear the reason they can actually act on.
 */
export async function resolveImportRows(
  supabase: UserClient,
  rows: DraftImportRow[],
  market: MarketCode,
  /**
   * Row indices the CALLER already knows are repeats, from the whole file.
   *
   * The preview is chunked, so a ticker appearing at row 3 and row 40 lands in
   * two different requests and neither can see the other — the trader would be
   * shown two clean rows and then find the second one silently skipped at
   * commit, having never been offered the checkbox. The client, which holds the
   * whole file, supplies this. It only ever ADDS a warning, and the commit
   * route computes its own over the full set, so nothing here is load-bearing
   * on client-supplied data.
   */
  knownRepeats: readonly number[] = [],
): Promise<ResolvedImportRow[]> {
  const exchanges = exchangesFor(market);
  // Two index spaces meet here: `repeats` is by position within this chunk,
  // `knownRepeats` is by row index in the trader's file.
  const repeats = repeatedTickerIndices(rows.map((r) => r.ticker));
  const knownRepeatSet = new Set(knownRepeats);
  const held = await tickersAlreadyHeld(supabase);

  const resolved: ResolvedImportRow[] = rows.map((row) => ({
    ...row,
    status: "resolved",
    reason: null,
    companyName: null,
    exchange: null,
    yahooSymbol: null,
    lastPrice: null,
  }));

  // Price every row that is structurally sound — including likely duplicates,
  // because the trader may confirm one and will want to see which company it
  // is before deciding.
  const priceable = resolved.filter((row) => rowValidationError(row) === null);

  await mapWithConcurrency(priceable, MAX_CONCURRENT_QUOTES, async (row) => {
    for (const exchange of exchanges) {
      const yahooSymbol = resolveYahooSymbol(row.ticker, exchange);
      try {
        const quote = await getQuote(yahooSymbol);
        row.exchange = exchange;
        row.yahooSymbol = yahooSymbol;
        row.companyName = quote.name;
        row.lastPrice = quote.price;
        return;
      } catch {
        // Not listed on this exchange, or Yahoo is unhappy. Try the next one;
        // exhausting the list is what "unresolved" means.
        continue;
      }
    }
  });

  for (const [position, row] of resolved.entries()) {
    const invalid = rowValidationError(row);
    if (invalid !== null) {
      row.status = "invalid";
      row.reason = invalid;
    } else if (row.yahooSymbol === null) {
      row.status = "unresolved";
      row.reason = `No listing found for ${row.ticker} in this market`;
    } else if (repeats.has(position) || knownRepeatSet.has(row.index)) {
      row.status = "duplicate";
      row.reason = `${row.ticker} appears more than once in this file`;
    } else if (held.has(row.ticker.toUpperCase())) {
      row.status = "duplicate";
      row.reason = `You already hold an open position in ${row.ticker}`;
    }
  }

  return resolved;
}

/** Tickers the trader already has an open position in. RLS scopes the query. */
async function tickersAlreadyHeld(supabase: UserClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("positions")
    .select("ticker")
    .in("status", ["active", "partial_exit"]);
  // A failed lookup must not silently disarm duplicate detection — the whole
  // point of the flag is that a second position in the same name is usually a
  // re-upload, not a decision.
  if (error) throw new Error(`Could not check existing positions: ${error.message}`);
  return new Set((data ?? []).map((p) => p.ticker.toUpperCase()));
}
