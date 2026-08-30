import { createClient } from "@/lib/supabase/server";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";

/**
 * The read queries behind the list screens, in one place so a Server Component
 * and its matching route handler run the *same* code instead of the page making
 * an HTTP request to the route.
 *
 * Server Components used to self-fetch (`fetch("https://<host>/api/positions")`)
 * via a `lib/server-fetch.ts` helper. That is an anti-pattern and it broke in
 * production: the page has to guess its own public URL, forward the session
 * cookie by hand, and survive `middleware.ts` — and anything that answers with
 * HTML instead of JSON (a redirect to `/login`, Vercel's Deployment Protection
 * SSO page, a platform error page) makes the page's `res.json()` throw
 * `SyntaxError: Unexpected token '<', "<!DOCTYPE "...`, which renders as an
 * opaque "A server error occurred". It also billed a second serverless
 * invocation for every page view.
 *
 * A Server Component is already on the server: it should query directly. The
 * route handlers remain for the browser-side callers that genuinely need HTTP.
 *
 * These throw on failure rather than returning an error shape — a list screen
 * that cannot read its list has nothing to render, so the nearest `error.tsx`
 * is the right place to handle it.
 */

function fail(message: string): never {
  throw new Error(message);
}

export async function listJournalEntries() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_journal_entries")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return data ?? [];
}

export async function listTheses() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("theses")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return data ?? [];
}

/**
 * The signed-in trader's Investment Council roster, in display order.
 *
 * Built-ins seed at sort_order 1-3 and custom members default to 100, so the
 * three defaults lead and additions follow in the order they were made.
 */
export async function listCouncilMembers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("council_members")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) fail(error.message);
  return data ?? [];
}

export async function listRecommendations() {
  const supabase = await createClient();

  const { data: recommendations, error } = await supabase
    .from("jarvis_recommendations")
    .select("*")
    .order("recommended_at", { ascending: false });
  if (error) fail(error.message);
  if (!recommendations || recommendations.length === 0) return [];

  const stockIds = [...new Set(recommendations.map((r) => r.stock_id))];
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("id, last_price, exchange")
    .in("id", stockIds);
  if (stocksError) fail(stocksError.message);
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));

  return recommendations.map((rec) => ({
    recommendation: rec,
    stock: stockById.get(rec.stock_id),
  }));
}

export async function listOpenPositions() {
  const supabase = await createClient();

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("*")
    .in("status", ["active", "partial_exit"]);
  if (positionsError) fail(positionsError.message);
  if (!positions || positions.length === 0) return [];

  const positionIds = positions.map((p) => p.id);
  const stockIds = [...new Set(positions.map((p) => p.stock_id))];
  const tradePlanIds = [...new Set(positions.map((p) => p.trade_plan_id))];
  const thesisIds = [...new Set(positions.map((p) => p.thesis_id))];

  const [{ data: entries }, { data: stocks }, { data: tradePlans }, { data: theses }] =
    await Promise.all([
      supabase.from("entries").select("*").in("position_id", positionIds),
      supabase.from("stocks").select("*").in("id", stockIds),
      supabase.from("trade_plans").select("*").in("id", tradePlanIds),
      supabase.from("theses").select("id, conviction_tier").in("id", thesisIds),
    ]);

  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));

  return positions.map((p) => ({
    position: p,
    stock: stockById.get(p.stock_id),
    tradePlan: tradePlanById.get(p.trade_plan_id),
    weightedAverage: computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []),
    convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
  }));
}
