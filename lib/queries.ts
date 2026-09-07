import type { SupabaseClient } from "@supabase/supabase-js";

import { limitsFor } from "@/lib/llm/budget";
import { currencyForExchange } from "@/lib/markets";
import type { PortfolioScope } from "@/lib/portfolio/scope";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types";
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

type Client = SupabaseClient<Database>;

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
    // `/thesis` lists analyses the trader ran. The synthetic thesis behind an
    // imported holding (0020) is a carrier for a position, not an analysis —
    // thirty of them would bury the ones that are. They live on `/positions`.
    .neq("source", "imported")
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
/**
 * This account's LLM spend: both windows against their limits, plus a
 * per-feature breakdown of the current month.
 *
 * Read-only by construction — `authenticated` has SELECT and nothing else on
 * `llm_usage` (0018), because a ledger its subject can edit is not a limit.
 */
export async function getUsageSummary() {
  const supabase = await createClient();

  // Both reads throw on failure rather than degrading to zero. Reporting "$0
  // spent" during a permission or schema failure would tell the trader they
  // have room they may not have, and would quietly drop the Council dialog's
  // over-budget warning.
  const { data: statusRows, error: statusError } = await supabase.rpc("llm_budget_status");
  if (statusError) fail(statusError.message);
  const raw = statusRows?.[0];
  const status = {
    daily_spent: Number(raw?.daily_spent ?? 0),
    monthly_spent: Number(raw?.monthly_spent ?? 0),
    daily_limit: raw?.daily_limit == null ? null : Number(raw.daily_limit),
    monthly_limit: raw?.monthly_limit == null ? null : Number(raw.monthly_limit),
    has_override: raw?.has_override ?? false,
  };

  // Aggregated in SQL (0019), not by pulling every row and grouping here.
  // PostgREST caps a response at 1000 rows, so the old approach silently
  // understated any account past 1000 calls in a month — reachable precisely
  // for the uncapped account this feature exists to support.
  const { data: rows, error: featureError } = await supabase.rpc("llm_usage_by_feature");
  if (featureError) fail(featureError.message);

  return {
    ...status,
    limits: limitsFor(status),
    byFeature: (rows ?? []).map((r) => ({
      feature: r.feature,
      costUsd: Number(r.cost_usd),
      calls: Number(r.calls),
    })),
    /** Calls priced from the local table rather than OpenRouter's own number. */
    estimatedCalls: (rows ?? []).reduce((n, r) => n + Number(r.estimated_calls), 0),
  };
}

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

/**
 * Open positions in one book, or across every book for the roll-up.
 *
 * `scope` is required rather than defaulted, and that is the point: making it
 * optional would mean every caller that forgot it silently read the whole
 * account, which is precisely the bug this argument exists to prevent. The
 * compiler finds the call sites instead of a trader finding them.
 */
export async function listOpenPositions(scope: PortfolioScope) {
  const supabase = await createClient();

  let positionsQuery = supabase.from("positions").select("*").in("status", ["active", "partial_exit"]);
  if (scope.mode === "one") positionsQuery = positionsQuery.eq("portfolio_id", scope.id);
  const { data: positions, error: positionsError } = await positionsQuery;
  if (positionsError) fail(positionsError.message);
  if (!positions || positions.length === 0) return [];

  const positionIds = positions.map((p) => p.id);
  const stockIds = [...new Set(positions.map((p) => p.stock_id))];
  const tradePlanIds = [...new Set(positions.map((p) => p.trade_plan_id))];
  const thesisIds = [...new Set(positions.map((p) => p.thesis_id))];

  const [{ data: entries }, { data: exits }, { data: stocks }, { data: tradePlans }, { data: theses }] =
    await Promise.all([
      supabase.from("entries").select("*").in("position_id", positionIds),
      supabase.from("exits").select("position_id, quantity").in("position_id", positionIds),
      supabase.from("stocks").select("*").in("id", stockIds),
      supabase.from("trade_plans").select("*").in("id", tradePlanIds),
      supabase.from("theses").select("id, conviction_tier, source").in("id", thesisIds),
    ]);

  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const exitedByPosition = new Map<string, number>();
  for (const e of exits ?? []) {
    exitedByPosition.set(e.position_id, (exitedByPosition.get(e.position_id) ?? 0) + e.quantity);
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));

  return positions.map((p) => ({
    position: p,
    stock: stockById.get(p.stock_id),
    tradePlan: tradePlanById.get(p.trade_plan_id),
    weightedAverage: computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []),
    /** Shares sold so far. A `partial_exit` position holds the remainder. */
    exitedQuantity: exitedByPosition.get(p.id) ?? 0,
    convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
    // Imported holdings have no trade plan behind them (0020), and the table
    // says so rather than rendering an all-null plan like an analysed one.
    source: thesisById.get(p.thesis_id)?.source ?? "jarvis",
  }));
}

/**
 * Everything `/feed` shows: every signal (the tab filter is the client's job)
 * plus the 14-day time-exit agenda.
 *
 * Takes a client rather than making one, so the page and `GET /api/signals`
 * share a single Supabase client per request instead of opening two.
 *
 * Spec US-08: returns ALL signals, active and archived — the client filters by
 * tab. Active signals sort RED -> AMBER -> BLUE -> GREY, then recency within
 * each tier (the query already orders by `created_at` descending, and
 * `Array.prototype.sort` is stable, so a priority-only sort preserves that
 * recency ordering within each tier). Archived signals sort by `archived_at`
 * descending, most recently reviewed first — the tab split already keeps the
 * two groups visually separate, so this is just about within-tab order.
 */
const SIGNAL_PRIORITY_ORDER: Record<string, number> = { red: 0, amber: 1, blue: 2, grey: 3 };

export async function readSignalFeed(supabase: Client) {
  // Independent reads, so they go together. The agenda's positions have
  // nothing to do with the signals list, and running them in series put a
  // round trip on the screen for no reason.
  const [{ data: signals, error }, { data: positions }] = await Promise.all([
    supabase.from("intelligence_signals").select("*").order("created_at", { ascending: false }),
    supabase.from("positions").select("id, ticker, trade_plan_id").in("status", ["active", "partial_exit"]),
  ]);
  if (error) fail(error.message);

  const active = (signals ?? []).filter((s) => !s.archived_at);
  const archived = (signals ?? []).filter((s) => s.archived_at);
  const sortedActive = [...active].sort(
    (a, b) => SIGNAL_PRIORITY_ORDER[a.priority] - SIGNAL_PRIORITY_ORDER[b.priority],
  );
  const sortedArchived = [...archived].sort((a, b) =>
    (b.archived_at ?? "").localeCompare(a.archived_at ?? ""),
  );

  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const tradePlanIds = [...new Set((positions ?? []).map((p) => p.trade_plan_id))];
  const { data: tradePlans } = tradePlanIds.length
    ? await supabase.from("trade_plans").select("id, time_exit_date").in("id", tradePlanIds)
    : { data: [] };
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));

  const agenda = (positions ?? [])
    .map((p) => ({
      ticker: p.ticker,
      timeExitDate: tradePlanById.get(p.trade_plan_id)?.time_exit_date ?? null,
    }))
    .filter((a) => a.timeExitDate !== null && a.timeExitDate >= today && a.timeExitDate <= in14Days)
    .sort((a, b) => a.timeExitDate!.localeCompare(b.timeExitDate!));

  return { signals: [...sortedActive, ...sortedArchived], agenda };
}

/**
 * The watchlist behind `/discovery` (US-20/US-21), each row resolved to a
 * current price and its HELD / DRAFT badges.
 *
 * Cross-referenced on `ticker` rather than a foreign key: no FK exists between
 * `opportunities` and `stocks`/`positions`/`theses` — that is Decision #2's
 * denormalized-ticker pattern, not an omission.
 */
export async function readOpportunities(supabase: Client) {
  const { data: opportunities, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("conviction_tier", { ascending: true, nullsFirst: false });
  if (error) fail(error.message);

  const rows = opportunities ?? [];
  if (rows.length === 0) return [];

  const tickers = [...new Set(rows.map((o) => o.ticker))];
  const [{ data: stocks }, { data: positions }, { data: theses }] = await Promise.all([
    supabase
      .from("stocks")
      .select("ticker, exchange, currency, last_price, last_price_at")
      .in("ticker", tickers),
    supabase.from("positions").select("ticker").in("status", ["active", "partial_exit"]).in("ticker", tickers),
    supabase.from("theses").select("ticker, status").eq("status", "draft").in("ticker", tickers),
  ]);
  const stockByTicker = new Map((stocks ?? []).map((s) => [s.ticker, s]));
  const heldTickers = new Set((positions ?? []).map((p) => p.ticker));
  const draftTickers = new Set((theses ?? []).map((t) => t.ticker));

  return rows.map((o) => {
    const stock = stockByTicker.get(o.ticker);
    return {
      opportunity: o,
      currentPrice: stock?.last_price ?? null,
      lastPriceAt: stock?.last_price_at ?? null,
      // Falls back to the opportunity's own exchange when this ticker has no
      // `stocks` row yet — in which case there is no price to label either.
      currency: stock?.currency ?? currencyForExchange(o.market),
      held: heldTickers.has(o.ticker),
      draft: draftTickers.has(o.ticker),
    };
  });
}

/**
 * One position with everything Screens 5-6 need to enforce exit discipline:
 * its entries (weighted average), its exits (which ladder rungs are already
 * DONE), its trade plan (stop/targets/thesis conditions), its thesis
 * (invalidation condition), its stock (price + exchange), the holding reviews
 * and the watch state.
 *
 * `null` when there is no such position — that is a 404, not a failure.
 *
 * Deliberately a lead query plus seven parallel ones rather than one PostgREST
 * embed. The joins hang off `positions`' own FKs in four different directions,
 * the flat shape below is what the screen actually consumes, and there is no
 * route test here to catch an embed that resolves to something subtly wrong.
 * Two round trips instead of one is a few milliseconds now that the app runs
 * beside its database; getting the join wrong is a blank exit ladder.
 */
export async function readPositionDetail(supabase: Client, id: string) {
  const { data: position, error } = await supabase
    .from("positions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !position) return null;

  const [
    { data: entries },
    { data: exits },
    { data: tradePlan },
    { data: thesis },
    { data: stock },
    { data: reviews },
    { data: watch },
  ] = await Promise.all([
    supabase.from("entries").select("*").eq("position_id", id).order("date", { ascending: true }),
    supabase.from("exits").select("*").eq("position_id", id).order("date", { ascending: true }),
    supabase.from("trade_plans").select("*").eq("id", position.trade_plan_id).single(),
    supabase.from("theses").select("*").eq("id", position.thesis_id).single(),
    supabase.from("stocks").select("*").eq("id", position.stock_id).single(),
    // Newest first, and capped: the page shows the latest read expanded and
    // the rest collapsed, and a holding watched for a year has no business
    // shipping fifty documents to render three.
    supabase
      .from("holding_reviews")
      .select("*")
      .eq("position_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("holding_watch_state").select("last_checked_at").eq("position_id", id).maybeSingle(),
  ]);

  return {
    position,
    entries: entries ?? [],
    exits: exits ?? [],
    tradePlan: tradePlan ?? null,
    thesis: thesis ?? null,
    stock: stock ?? null,
    reviews: reviews ?? [],
    // Null `last_checked_at` on an existing row means the initial read is
    // queued but has not run yet — which the page says out loud, because
    // silence would read as "Jarvis has nothing to say about this holding".
    watch: watch ?? null,
  };
}

export type PositionDetail = NonNullable<Awaited<ReturnType<typeof readPositionDetail>>>;
