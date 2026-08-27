import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { computePositionPnl } from "@/lib/position-metrics";

/**
 * Screen HUB-1's single aggregated read — everything the Velocity Cockpit
 * needs in one round trip: open positions (with their stock/trade-plan/thesis
 * joins already resolved the same way `GET /api/positions` does), the Jarvis
 * recommendation feed, the portfolio-wide open P&L, and the tickers whose
 * thesis-test date has passed.
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
export async function GET() {
  const supabase = createAdminClient();

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("*")
    .in("status", ["active", "partial_exit"]);
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
      thesisIds.length ? supabase.from("theses").select("id, conviction_tier").in("id", thesisIds) : empty,
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

  // Both sides of the percent are restricted to the same set of positions —
  // the shares still held (entries minus exits) of a position that actually
  // has a quoted price. Dividing a remainder-only P&L by the full original
  // cost basis would understate the return of every partially-exited position.
  let totalAbsolute = 0;
  let totalCostBasis = 0;
  const positionResult = positionRows.map((p) => {
    const stock = stockById.get(p.stock_id);
    const tradePlan = tradePlanById.get(p.trade_plan_id);
    const weightedAverage = computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []);
    const remaining = weightedAverage.totalQuantity - (exitedByPosition.get(p.id) ?? 0);
    if (stock?.last_price != null && remaining > 0) {
      totalAbsolute += computePositionPnl({
        currentPrice: stock.last_price,
        avgEntry: weightedAverage.averagePrice,
        quantity: remaining,
      }).absolute;
      totalCostBasis += weightedAverage.averagePrice * remaining;
    }
    return {
      position: p,
      stock,
      tradePlan,
      weightedAverage,
      convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
    };
  });

  const totalOpenPnl = {
    absolute: totalAbsolute,
    percent: totalCostBasis > 0 ? (totalAbsolute / totalCostBasis) * 100 : 0,
  };

  const today = new Date().toISOString().slice(0, 10);
  const overdueTickers = positionRows
    .filter((p) => {
      const tradePlan = tradePlanById.get(p.trade_plan_id);
      return tradePlan?.time_exit_date != null && tradePlan.time_exit_date < today;
    })
    .map((p) => p.ticker);

  const recStockIds = [...new Set((recs ?? []).map((r) => r.stock_id))];
  const { data: recStocks } = recStockIds.length
    ? await supabase.from("stocks").select("id, last_price, exchange").in("id", recStockIds)
    : empty;
  const recStockById = new Map((recStocks ?? []).map((s) => [s.id, s]));
  const recommendations = (recs ?? []).map((r) => ({
    recommendation: r,
    stock: recStockById.get(r.stock_id),
  }));

  return NextResponse.json({ positions: positionResult, recommendations, totalOpenPnl, overdueTickers });
}
