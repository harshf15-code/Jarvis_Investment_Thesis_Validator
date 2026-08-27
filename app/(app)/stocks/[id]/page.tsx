import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusChip } from "@/components/dashboard/status-chip";
import { AlertHistoryLog } from "@/components/stock-detail/alert-history-log";
import { CandlestickChart } from "@/components/stock-detail/candlestick-chart";
import { FundamentalsPanel } from "@/components/stock-detail/fundamentals-panel";
import { HoldingTypeAction } from "@/components/stock-detail/holding-actions";
import { JarvisTabs } from "@/components/stock-detail/jarvis-tabs";
import { RunJarvisButton } from "@/components/stock-detail/run-jarvis-button";
import { formatCurrency, formatExchangeTime } from "@/lib/format";
import { getHistoricalOHLCV } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AlertCriteria,
  AlertLog,
  FundamentalRow,
  JarvisAnalysis,
  Json,
  Stock,
} from "@/lib/types";

/**
 * Forces per-request rendering, same rationale as `app/(app)/page.tsx`:
 * this page calls `createAdminClient()` (throws at build time without live
 * Supabase env vars) and `getHistoricalOHLCV` (a live Yahoo call), neither
 * of which should ever run during `next build`.
 */
export const dynamic = "force-dynamic";

function formatAsOf(iso: string | null, exchange: Stock["exchange"]): string {
  if (iso === null) {
    return "No price yet";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "No price yet";
  }
  return `as of ${formatExchangeTime(date, exchange)}`;
}

function formatDateOnly(dateStr: string | null): string {
  if (dateStr === null) {
    return "—";
  }
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

type TrimTarget = { price: number; pct_of_position: number };

/**
 * `alert_criteria.trim_targets` is a `jsonb` column with no DB-level shape
 * enforcement; this defensively narrows to the shape
 * `AlertCriteriaExtractSchema` (`lib/jarvis-parser.ts`) actually writes,
 * dropping (rather than crashing on) any entry that doesn't match.
 */
function extractTrimTargets(json: Json): TrimTarget[] {
  if (!Array.isArray(json)) {
    return [];
  }
  const result: TrimTarget[] = [];
  for (const item of json) {
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.price === "number" &&
      typeof item.pct_of_position === "number"
    ) {
      result.push({ price: item.price, pct_of_position: item.pct_of_position });
    }
  }
  return result;
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-on-surface/50">{label}</span>
      <span className="text-sm font-medium text-on-surface">{value}</span>
    </div>
  );
}

/**
 * Renders only when an `alert_criteria` row is active for this stock — the
 * caller (`StockDetailPage`) simply doesn't render this at all when there
 * is none, per the brief ("if `alert_criteria` is active, a small summary
 * strip..."). Lets the user see the numbers the alert engine is actually
 * watching without opening the Trade Plan tab.
 */
function AlertCriteriaSummaryStrip({
  criteria,
  exchange,
}: {
  criteria: AlertCriteria;
  exchange: Stock["exchange"];
}) {
  const trimTargets = extractTrimTargets(criteria.trim_targets);

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-surface-container-low px-5 py-4">
      <SummaryField
        label="Entry zone"
        value={
          criteria.entry_low !== null && criteria.entry_high !== null
            ? `${formatCurrency(criteria.entry_low, exchange)} – ${formatCurrency(criteria.entry_high, exchange)}`
            : "—"
        }
      />
      <SummaryField
        label="Stop loss"
        value={
          criteria.stop_loss !== null
            ? formatCurrency(criteria.stop_loss, exchange)
            : "—"
        }
      />
      <SummaryField
        label="Trim tiers"
        value={
          trimTargets.length > 0
            ? trimTargets
                .map(
                  (t) =>
                    `${formatCurrency(t.price, exchange)} (${t.pct_of_position}%)`,
                )
                .join(", ")
            : "—"
        }
      />
      <SummaryField
        label="Time exit"
        value={formatDateOnly(criteria.time_exit_date)}
      />
    </div>
  );
}

export default async function StockDetailPage({
  params,
}: PageProps<"/stocks/[id]">) {
  const { id } = await params;

  const supabase = createAdminClient();

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (stockError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <h1 className="font-display text-xl font-semibold text-on-surface">
          Couldn&apos;t load this stock
        </h1>
        <p className="max-w-sm text-sm text-on-surface/60">
          {stockError.message}
        </p>
      </main>
    );
  }

  // Missing row or soft-deleted: both are "not found" from the user's
  // perspective.
  if (!stock) {
    notFound();
  }

  // Every version, all fundamentals, and the full alert log are fetched up
  // front (not paginated/lazy) — `JarvisTabs`/`FundamentalsPanel`/
  // `AlertHistoryLog` all work off already-fetched data, so switching
  // between analysis versions never triggers a refetch.
  const [analysesResult, alertCriteriaResult, fundamentalsResult, alertLogResult] =
    await Promise.all([
      supabase
        .from("jarvis_analyses")
        .select("*")
        .eq("stock_id", id)
        .order("version", { ascending: false }),
      supabase
        .from("alert_criteria")
        .select("*")
        .eq("stock_id", id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase.from("fundamentals").select("*").eq("stock_id", id),
      supabase
        .from("alert_log")
        .select("*")
        .eq("stock_id", id)
        .order("triggered_at", { ascending: false }),
    ]);

  const analyses: JarvisAnalysis[] = analysesResult.data ?? [];
  const alertCriteria: AlertCriteria | null = alertCriteriaResult.data ?? null;
  const fundamentals: FundamentalRow[] = fundamentalsResult.data ?? [];
  const alertLog: AlertLog[] = alertLogResult.data ?? [];

  const autoFundamentals = fundamentals.filter((row) => row.source === "auto");
  const manualFundamentals = fundamentals.filter(
    (row) => row.source === "manual",
  );

  // A live Yahoo call, not a DB read — network/transport failures here
  // degrade to an empty chart (handled by `CandlestickChart`'s own "no
  // price history available" state) rather than failing the whole page.
  let ohlcv: Awaited<ReturnType<typeof getHistoricalOHLCV>> = [];
  try {
    ohlcv = await getHistoricalOHLCV(stock.yahoo_symbol);
  } catch {
    ohlcv = [];
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-10">
      <Link
        href="/"
        className="w-fit text-sm text-on-surface/50 transition-colors hover:text-on-surface"
      >
        ← Watchlist
      </Link>

      {/*
        Editorial header: the ticker/price reads as a large hero figure
        breaking a strict grid, rather than sitting inside a uniform card
        alongside everything else.
      */}
      <header className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-3xl font-bold text-on-surface">
                {stock.ticker}
              </h1>
              <span className="text-sm text-on-surface/50">
                {stock.exchange}
              </span>
              <StatusChip status={stock.status} />
            </div>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-6xl font-bold tracking-tight text-on-surface tabular-nums">
                {stock.last_price !== null
                  ? formatCurrency(stock.last_price, stock.exchange)
                  : "—"}
              </span>
              <span className="text-sm text-on-surface/40">
                {formatAsOf(stock.last_price_at, stock.exchange)}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <RunJarvisButton stockId={stock.id} />
            <HoldingTypeAction stockId={stock.id} type={stock.type} />
          </div>
        </div>

        {alertCriteria ? (
          <AlertCriteriaSummaryStrip
            criteria={alertCriteria}
            exchange={stock.exchange}
          />
        ) : null}
      </header>

      {/*
        Asymmetric two-column split (2fr/1fr), not a uniform 12-column
        grid: the chart + Jarvis analysis form the main editorial column,
        fundamentals/alert history sit in a narrower supporting rail.
      */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-on-surface">
              Price
            </h2>
            <CandlestickChart ohlcv={ohlcv} />
          </section>

          <section>
            {analyses.length > 0 ? (
              <JarvisTabs analyses={analyses} />
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-container-low px-6 py-14 text-center">
                <h2 className="font-display text-lg font-semibold text-on-surface">
                  No analysis yet
                </h2>
                <p className="max-w-sm text-sm text-on-surface/60">
                  Run Jarvis above to generate a thesis, stress test, and
                  trade plan for {stock.ticker}.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-10">
          <section className="rounded-xl bg-surface-container-low p-4">
            <FundamentalsPanel
              stockId={stock.id}
              autoFundamentals={autoFundamentals}
              manualFundamentals={manualFundamentals}
            />
          </section>

          <AlertHistoryLog alerts={alertLog} exchange={stock.exchange} />
        </div>
      </div>
    </main>
  );
}
