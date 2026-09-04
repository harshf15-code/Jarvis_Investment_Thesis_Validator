import { NextResponse } from "next/server";

import { listPortfolios, ownedOnly, requirePortfolioScope, resolveScope } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { computePositionPnl } from "@/lib/position-metrics";
import type { Portfolio } from "@/lib/types";

/**
 * Screen HUB-1's single aggregated read — everything the Cockpit needs in one
 * round trip: open positions (with their stock/trade-plan/thesis joins already
 * resolved the same way `GET /api/positions` does), the Jarvis recommendation
 * feed, the open P&L, and the tickers whose thesis-test date has passed.
 *
 * Scoped to one book since 0027, or to `?portfolio=all` for the roll-up. There
 * is no unscoped form: a request that does not say which book is a 400 rather
 * than a guess, because the wrong guess here shows one person's money as
 * another's.
 *
 * On "Total Open P&L" vs the spec's "today / week / MTD": the v2 schema keeps
 * no time series of portfolio value (`price_cache` was dropped in the full
 * schema replace), so a genuine day- or week-over-week delta is not
 * computable from what is stored. This returns the figure the schema *can*
 * support — total unrealized P&L since entry across every open position — and
 * the UI labels it as exactly that. The day/week/MTD breakdown needs a
 * `portfolio_snapshots` table written on a schedule; that is a named gap, not
 * a silent omission.
 */

type Bucket = { absolute: number; costBasis: number; positions: number };
export type CurrencyTotal = {
  currency: string;
  absolute: number;
  costBasis: number;
  percent: number;
  positions: number;
};

/**
 * Ordered by POSITION COUNT, then currency code.
 *
 * Not by cost basis: comparing ₹155,000 against $2,000 to decide which book
 * is "bigger" is the same cross-currency arithmetic the per-currency split
 * exists to remove — it ranks by the unit size of the money, so rupees would
 * always lead. Position count is currency-neutral and genuinely comparable, and
 * the tie-break keeps the order stable between requests rather than depending
 * on which position happened to be priced first.
 */
function toTotals(buckets: Map<string, Bucket>): CurrencyTotal[] {
  return [...buckets.entries()]
    .map(([currency, t]) => ({
      currency,
      absolute: t.absolute,
      costBasis: t.costBasis,
      percent: t.costBasis > 0 ? (t.absolute / t.costBasis) * 100 : 0,
      positions: t.positions,
    }))
    .sort((a, b) => b.positions - a.positions || a.currency.localeCompare(b.currency));
}

function addTo(buckets: Map<string, Bucket>, currency: string, absolute: number, costBasis: number) {
  const bucket = buckets.get(currency) ?? { absolute: 0, costBasis: 0, positions: 0 };
  bucket.absolute += absolute;
  bucket.costBasis += costBasis;
  bucket.positions += 1;
  buckets.set(currency, bucket);
}

export async function GET(request: Request) {
  const scope = requirePortfolioScope(request);
  if (scope instanceof Response) return scope;

  const supabase = await createClient();

  let allPortfolios: Portfolio[];
  try {
    allPortfolios = await listPortfolios(supabase);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read your portfolios." },
      { status: 500 },
    );
  }

  const inScope = resolveScope(allPortfolios, scope);
  if (!inScope) {
    // The same answer RLS gives for someone else's row, and for the same
    // reason: refusing differently would confirm the id exists.
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }
  const scopeIds = inScope.map((p) => p.id);

  let positionsQuery = supabase.from("positions").select("*").in("status", ["active", "partial_exit"]);
  if (scope.mode === "one") positionsQuery = positionsQuery.eq("portfolio_id", scopeIds[0]);
  const { data: positions, error: positionsError } = await positionsQuery;
  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }

  const positionRows = positions ?? [];
  const positionIds = positionRows.map((p) => p.id);
  const stockIds = [...new Set(positionRows.map((p) => p.stock_id))];
  const tradePlanIds = [...new Set(positionRows.map((p) => p.trade_plan_id))];
  const thesisIds = [...new Set(positionRows.map((p) => p.thesis_id))];

  const empty = { data: [] as never[] };
  const [{ data: entries }, { data: exits }, { data: stocks }, { data: tradePlans }, { data: theses }, { data: recs }] =
    await Promise.all([
      positionIds.length ? supabase.from("entries").select("*").in("position_id", positionIds) : empty,
      positionIds.length ? supabase.from("exits").select("*").in("position_id", positionIds) : empty,
      stockIds.length ? supabase.from("stocks").select("*").in("id", stockIds) : empty,
      tradePlanIds.length ? supabase.from("trade_plans").select("*").in("id", tradePlanIds) : empty,
      thesisIds.length ? supabase.from("theses").select("id, conviction_tier, title, ticker").in("id", thesisIds) : empty,
      // Account-wide on purpose. A recommendation is pre-position — nothing has
      // been bought yet, so there is no book it belongs to. It acquires one at
      // the moment it is converted, which is where the picker is.
      supabase.from("jarvis_recommendations").select("*").order("recommended_at", { ascending: false }),
    ]);

  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const exitedByPosition = new Map<string, number>();
  for (const ex of exits ?? []) {
    exitedByPosition.set(ex.position_id, (exitedByPosition.get(ex.position_id) ?? 0) + ex.quantity);
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));

  // Totalled PER CURRENCY, never blended, and now per BOOK as well.
  //
  // The per-currency split was already the answer to "there is no honest single
  // number without an exchange rate, and this app holds none". The per-book
  // split is the same argument one level up: a managed book is somebody else's
  // capital, and adding it to the trader's own is not a rounding error, it is a
  // different question being answered.
  //
  // Both sides of each percent are restricted to the same set of positions —
  // the shares still held (entries minus exits) of a position that actually
  // has a quoted price. Dividing a remainder-only P&L by the full original
  // cost basis would understate the return of every partially-exited position.
  const perBook = new Map<string, Map<string, Bucket>>(scopeIds.map((id) => [id, new Map()]));
  const positionResult = positionRows.map((p) => {
    const stock = stockById.get(p.stock_id);
    const tradePlan = tradePlanById.get(p.trade_plan_id);
    const weightedAverage = computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []);
    const remaining = weightedAverage.totalQuantity - (exitedByPosition.get(p.id) ?? 0);
    if (stock?.last_price != null && remaining > 0) {
      const { absolute } = computePositionPnl({
        currentPrice: stock.last_price,
        avgEntry: weightedAverage.averagePrice,
        quantity: remaining,
      });
      const book = perBook.get(p.portfolio_id);
      if (book) addTo(book, stock.currency, absolute, weightedAverage.averagePrice * remaining);
    }
    return {
      position: p,
      stock,
      tradePlan,
      weightedAverage,
      convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
    };
  });

  // In the ROLL-UP the headline sums owned books only: a managed book is
  // somebody else's capital, and folding it into the number a trader reads as
  // their own net worth makes that number mean something other than what it
  // says. It is rendered beneath instead, as its own labelled card.
  //
  // Opening a managed book on its own is a different question, and gets a
  // different answer. "How is the money I run for my mother doing" is the whole
  // reason that book exists; excluding it here too left the screen showing her
  // positions above a blank P&L, which is not caution, just a missing number.
  const headlineBooks = scope.mode === "all" ? ownedOnly(inScope) : inScope;
  const headlineIds = new Set(headlineBooks.map((p) => p.id));
  const headline = new Map<string, Bucket>();
  for (const [portfolioId, buckets] of perBook) {
    if (!headlineIds.has(portfolioId)) continue;
    for (const [currency, t] of buckets) {
      const bucket = headline.get(currency) ?? { absolute: 0, costBasis: 0, positions: 0 };
      bucket.absolute += t.absolute;
      bucket.costBasis += t.costBasis;
      bucket.positions += t.positions;
      headline.set(currency, bucket);
    }
  }

  const byPortfolio = inScope.map((portfolio) => ({
    portfolio,
    totalsByCurrency: toTotals(perBook.get(portfolio.id) ?? new Map()),
    positionCount: positionRows.filter((p) => p.portfolio_id === portfolio.id).length,
  }));

  // De-duplicated: two open positions can sit on the same ticker (separate
  // theses), and the rail should show one chip per ticker, not one per row.
  const today = new Date().toISOString().slice(0, 10);
  const overdueTickers = [
    ...new Set(
      positionRows
        .filter((p) => {
          const tradePlan = tradePlanById.get(p.trade_plan_id);
          return tradePlan?.time_exit_date != null && tradePlan.time_exit_date < today;
        })
        .map((p) => p.ticker),
    ),
  ];

  const recStockIds = [...new Set((recs ?? []).map((r) => r.stock_id))];
  const { data: recStocks } = recStockIds.length
    ? await supabase.from("stocks").select("id, last_price, exchange").in("id", recStockIds)
    : empty;
  const recStockById = new Map((recStocks ?? []).map((s) => [s.id, s]));
  const recommendations = (recs ?? []).map((r) => ({
    recommendation: r,
    stock: recStockById.get(r.stock_id),
  }));

  return NextResponse.json({
    positions: positionResult,
    recommendations,
    totalsByCurrency: toTotals(headline),
    overdueTickers,
    /** Which books this read covered, so the header can name what is on screen. */
    scope: { mode: scope.mode, portfolios: inScope },
    /** Per-book totals. One entry in single-book mode; every book in the roll-up. */
    byPortfolio,
  });
}
