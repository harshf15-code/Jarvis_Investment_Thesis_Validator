import { MAX_CONCURRENT_QUOTES, mapWithConcurrency } from "@/lib/concurrency";
import { cryptoStockKey, getCryptoPrices } from "@/lib/crypto-data";
import { getQuote, resolveYahooSymbol } from "@/lib/market-data";
import { currencyForMarket, exchangesFor } from "@/lib/markets";
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
   * The book being imported into. Duplicate detection is per-book since 0027.
   *
   * "You already hold an open position in INFY" has to be true of THIS book to
   * be an answer. Holding INFY in a portfolio run for someone else is not a
   * reason to warn a trader about buying it themselves, and warning anyway
   * would train them to click past the flag that catches a real re-upload.
   */
  portfolioId: string,
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
  const held = await tickersAlreadyHeld(supabase, portfolioId);

  const resolved: ResolvedImportRow[] = rows.map((row) => ({
    ...row,
    status: "resolved",
    reason: null,
    companyName: null,
    exchange: null,
    yahooSymbol: null,
    lastPrice: null,
    coingeckoId: null,
    currency: null,
  }));

  // Price every row that is structurally sound — including likely duplicates,
  // because the trader may confirm one and will want to see which company it
  // is before deciding.
  const priceable = resolved.filter((row) => rowValidationError(row) === null);

  // What every listing in this batch must be quoted in. A quote in anything
  // else did not come from the market the trader named.
  const expected = currencyForMarket(market);
  const wrongCurrency = new Map<number, string>();

  // Crypto prices through CoinGecko; everything else through Yahoo. ONLY this
  // step branches — validation, duplicate detection and the status tail below
  // are shared, so a coin re-uploaded flags exactly like a share re-uploaded
  // and there is no second copy of that logic to drift.
  if (market === "CRYPTO") {
    await priceCryptoRows(supabase, priceable, portfolioId);
  } else {
    await mapWithConcurrency(priceable, MAX_CONCURRENT_QUOTES, async (row) => {
      for (const exchange of exchanges) {
        const yahooSymbol = resolveYahooSymbol(row.ticker, exchange);
        try {
          const quote = await getQuote(yahooSymbol);
          // A US probe is a BARE ticker, so Yahoo is free to answer with a
          // foreign listing — `NESN` is Swiss francs, not dollars. Priced in
          // the wrong money it would import as a plausible cost basis off by
          // the exchange rate, which is exactly the failure one-market-per-batch
          // exists to prevent. Reject rather than convert: this app holds no FX
          // rate, and guessing one is how a book stops being true.
          if (quote.currency != null && quote.currency !== expected) {
            wrongCurrency.set(row.index, quote.currency);
            continue;
          }
          row.exchange = exchange;
          row.yahooSymbol = yahooSymbol;
          row.companyName = quote.name;
          row.lastPrice = quote.price;
          row.currency = quote.currency ?? expected;
          return;
        } catch {
          // Not listed on this exchange, or Yahoo is unhappy. Try the next one;
          // exhausting the list is what "unresolved" means.
          continue;
        }
      }
    });
  }

  for (const [position, row] of resolved.entries()) {
    const invalid = rowValidationError(row);
    if (invalid !== null) {
      row.status = "invalid";
      row.reason = invalid;
    } else if (row.yahooSymbol === null) {
      row.status = "unresolved";
      const wrong = wrongCurrency.get(row.index);
      row.reason =
        wrong !== undefined
          ? `${row.ticker} priced in ${wrong}, not ${expected} — that is a different listing to the one this market means`
          : market === "CRYPTO"
            ? `${row.ticker} is not one of the tracked top ten coins`
            : `No listing found for ${row.ticker} in this market`;
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

/**
 * Prices crypto rows in the BOOK's currency, resolving tickers against the
 * tracked universe.
 *
 * Mutates the rows it is given, exactly as the Yahoo loop above does, so the
 * shared status tail can judge both the same way.
 *
 * There is no currency gate here, and that is not an omission. The equity path
 * needs one because a bare US ticker lets Yahoo answer with a foreign listing;
 * CoinGecko is ASKED for a currency and returns that currency or nothing, so
 * there is no wrong money to catch.
 */
async function priceCryptoRows(
  supabase: UserClient,
  rows: ResolvedImportRow[],
  portfolioId: string,
): Promise<void> {
  if (rows.length === 0) return;

  const { data: book, error: bookError } = await supabase
    .from("portfolios")
    .select("base_currency")
    .eq("id", portfolioId)
    .maybeSingle();
  if (bookError) {
    throw new Error(`Could not read the portfolio's currency: ${bookError.message}`);
  }
  // The book is checked for existence by the route before this runs, so a
  // missing row here would be a programming error rather than a user one.
  const currency = book?.base_currency ?? "USD";

  const symbols = [...new Set(rows.map((r) => r.ticker.trim().toUpperCase()))];
  const { data: coins, error: coinError } = await supabase
    .from("crypto_universe")
    .select("coingecko_id, symbol, name")
    .in("symbol", symbols);
  if (coinError) {
    throw new Error(`Could not read the crypto universe: ${coinError.message}`);
  }
  const coinBySymbol = new Map((coins ?? []).map((c) => [c.symbol.toUpperCase(), c]));

  // One call prices every coin in the batch: `/simple/price` is batched.
  const ids = [...new Set([...coinBySymbol.values()].map((c) => c.coingecko_id))];
  // A CoinGecko outage, a rate limit, or a currency they do not quote must not
  // fail the import: a recognised coin is a real holding whether or not anyone
  // can price it this second, and the loop below already treats an unpriced row
  // as resolved. Letting this throw would have contradicted that three lines
  // later and 500ed the whole preview over a third party being down.
  let prices = new Map<string, { price: number; asOf: Date }>();
  try {
    prices = await getCryptoPrices(ids, currency);
  } catch {
    // Deliberately swallowed -- see above.
  }

  for (const row of rows) {
    const coin = coinBySymbol.get(row.ticker.trim().toUpperCase());
    // Left unresolved, which the status tail turns into a readable reason.
    if (!coin) continue;

    row.ticker = coin.symbol;
    row.exchange = "CRYPTO";
    row.yahooSymbol = cryptoStockKey(coin.coingecko_id, currency);
    row.coingeckoId = coin.coingecko_id;
    row.companyName = coin.name;
    row.currency = currency;
    // A coin the batch could not price still RESOLVES — the holding is real and
    // worth importing, and the next hourly poll fills the price in. Only an
    // unknown ticker is unresolved.
    row.lastPrice = prices.get(coin.coingecko_id)?.price ?? null;
  }
}

/** Tickers this BOOK already has an open position in. RLS scopes it to the
 *  trader; the portfolio narrows it to the one being imported into. */
async function tickersAlreadyHeld(
  supabase: UserClient,
  portfolioId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("positions")
    .select("ticker")
    .eq("portfolio_id", portfolioId)
    .in("status", ["active", "partial_exit"]);
  // A failed lookup must not silently disarm duplicate detection — the whole
  // point of the flag is that a second position in the same name is usually a
  // re-upload, not a decision.
  if (error) throw new Error(`Could not check existing positions: ${error.message}`);
  return new Set((data ?? []).map((p) => p.ticker.toUpperCase()));
}
