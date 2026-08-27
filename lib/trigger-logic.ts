import type { StockType, TriggerType } from "@/lib/types";
import type { StockStatus } from "@/components/dashboard/status-chip";

/**
 * Task 11's `supabase/functions/poll-prices/index.ts` Deno Edge Function
 * cannot import from `/lib` (Deno and Next.js are separate deployables), so
 * it carries its own hand-transcribed copy of the pure logic in this file.
 * This module exists to let that logic be authored, reasoned about, and
 * unit-tested with `vitest` on the Next.js side *before* being transcribed
 * into the Deno function — it is deliberately duplicated, not imported by
 * the Edge Function. If you change trigger/status/dedup semantics here,
 * update `supabase/functions/poll-prices/index.ts`'s copy to match.
 *
 * Chosen home: `lib/trigger-logic.ts` (sibling to `lib/market-hours.ts` and
 * `lib/market-data.ts`, the two other modules Task 11's Edge Functions
 * conceptually mirror) rather than e.g. a nested `lib/alerts/` directory —
 * this repo doesn't have prior precedent for subdirectories under `lib/`
 * for a single-file concern, so a flat file matches existing conventions
 * (`lib/pnl.ts`, `lib/sma.ts`, etc.).
 */

/** The subset of `alert_criteria` columns `evaluateTriggers` reads. */
export type TriggerAlertCriteriaInput = {
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  trim_targets: { price: number; pct_of_position: number }[];
  earnings_date: string | null; // ISO `date` (YYYY-MM-DD), no time component
  reassessment_date: string | null; // ISO `date`
  time_exit_date: string | null; // ISO `date`
};

/** The subset of `stocks` columns `evaluateTriggers` reads. */
export type TriggerStockInput = {
  type: StockType;
};

export type TriggerEvent =
  | {
      type: "entry_zone_reached";
      details: { price: number; entry_low: number; entry_high: number };
    }
  | {
      type: "stop_loss_breached";
      details: { price: number; stop_loss: number };
    }
  | {
      type: "trim_target_reached";
      details: {
        price: number;
        tier_price: number;
        pct_of_position: number;
        tier_index: number;
      };
    }
  | {
      type: "earnings_approaching";
      details: { earnings_date: string; days_out: number };
    }
  | {
      type: "reassess_due";
      details: { reassess_date: string };
    };

/**
 * Days from `now` (in UTC, date-only) to `dateStr` (an ISO `date` column
 * value, e.g. `"2026-09-01"`). Positive = in the future, 0 = today,
 * negative = in the past.
 *
 * Both sides are compared as UTC midnight instants rather than in the host
 * machine's local timezone: Postgres `date` columns carry no timezone, and
 * comparing calendar dates (not instants) is what "earnings is N days out"
 * / "reassessment date has passed" mean here — using local time would let
 * the host machine's timezone shift which calendar day "today" is relative
 * to the stored date.
 */
function daysBetweenDateOnly(dateStr: string, now: Date): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const nowUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target - nowUtcMidnight) / msPerDay);
}

/**
 * Evaluates every alert trigger condition for one stock at one instant.
 * Pure function: no I/O, no mutation, returns every trigger that currently
 * applies (zero, one, or several — e.g. a holding can cross two trim tiers
 * in the same evaluation).
 *
 * Mirrors task-11-brief.md's rules exactly:
 * - `entry_zone_reached`: `type === "watchlist"`, both `entry_low`/
 *   `entry_high` non-null, `price` within `[entry_low, entry_high]`
 *   (inclusive both ends).
 * - `stop_loss_breached`: `type === "holding"`, `stop_loss` non-null,
 *   `price <= stop_loss`.
 * - `trim_target_reached`: `type === "holding"`, one event per
 *   `trim_targets` tier where `price >= tier.price` (order preserved,
 *   `tier_index` is the position in the `trim_targets` array).
 * - `earnings_approaching`: `earnings_date` non-null and 0-3 days out
 *   inclusive.
 * - `reassess_due`: `(reassessment_date ?? time_exit_date)` non-null and
 *   that date is today or in the past.
 */
export function evaluateTriggers(
  stock: TriggerStockInput,
  alertCriteria: TriggerAlertCriteriaInput,
  price: number,
  now: Date,
): TriggerEvent[] {
  const events: TriggerEvent[] = [];

  if (
    stock.type === "watchlist" &&
    alertCriteria.entry_low !== null &&
    alertCriteria.entry_high !== null &&
    price >= alertCriteria.entry_low &&
    price <= alertCriteria.entry_high
  ) {
    events.push({
      type: "entry_zone_reached",
      details: {
        price,
        entry_low: alertCriteria.entry_low,
        entry_high: alertCriteria.entry_high,
      },
    });
  }

  if (
    stock.type === "holding" &&
    alertCriteria.stop_loss !== null &&
    price <= alertCriteria.stop_loss
  ) {
    events.push({
      type: "stop_loss_breached",
      details: { price, stop_loss: alertCriteria.stop_loss },
    });
  }

  if (stock.type === "holding") {
    alertCriteria.trim_targets.forEach((tier, tierIndex) => {
      if (price >= tier.price) {
        events.push({
          type: "trim_target_reached",
          details: {
            price,
            tier_price: tier.price,
            pct_of_position: tier.pct_of_position,
            tier_index: tierIndex,
          },
        });
      }
    });
  }

  if (alertCriteria.earnings_date !== null) {
    const daysOut = daysBetweenDateOnly(alertCriteria.earnings_date, now);
    if (daysOut >= 0 && daysOut <= 3) {
      events.push({
        type: "earnings_approaching",
        details: { earnings_date: alertCriteria.earnings_date, days_out: daysOut },
      });
    }
  }

  const reassessDate =
    alertCriteria.reassessment_date ?? alertCriteria.time_exit_date;
  if (reassessDate !== null) {
    const daysOut = daysBetweenDateOnly(reassessDate, now);
    if (daysOut <= 0) {
      events.push({
        type: "reassess_due",
        details: { reassess_date: reassessDate },
      });
    }
  }

  return events;
}

/**
 * Derives `stocks.status` from a stock's type and the set of trigger types
 * that fired for it in this evaluation (from `evaluateTriggers`'s output —
 * pass every fired event's `.type`, regardless of whether that event's
 * `alert_log` insert was deduped; status reflects current condition, not
 * "did we just log this").
 *
 * Precedence (documented per task-11-brief.md's explicit call for a chosen
 * order, since multiple triggers can be active simultaneously): **Stop Hit
 * > Trim Hit > Reassess Due > In Entry Zone > (Holding | Watching)**. This
 * is the brief's own suggested default, used as-is:
 * - A breached stop is the single highest-urgency condition for a holding
 *   (capital at risk right now) — it should never be visually buried
 *   behind a lower-urgency status.
 * - A trim target is next: still holding-only, still actionable, but not
 *   "the thesis may be broken" urgent like a stop.
 * - Reassess-due outranks entry-zone because it can apply to either a
 *   watchlist or a holding stock, and "the plan says re-look at this now"
 *   is a more direct call to action than "price is in a range you defined
 *   as interesting."
 * - `earnings_approaching` deliberately never determines status — it has
 *   no corresponding entry in `StockStatus`
 *   (`components/dashboard/status-chip.tsx`'s six-value union), so it's
 *   alert-only (still gets an `alert_log` row / shows in the digest) but
 *   doesn't change the dashboard chip.
 * - With no trigger active: `"Holding"` for holdings, `"Watching"` for
 *   watchlist entries (the DB default), matching `stocks.status`'s
 *   existing convention (`0001_init.sql`, `status-chip.tsx`).
 */
export function deriveStatus(
  stockType: StockType,
  firedTriggerTypes: TriggerType[],
): StockStatus {
  const has = (t: TriggerType) => firedTriggerTypes.includes(t);

  if (has("stop_loss_breached")) return "Stop Hit";
  if (has("trim_target_reached")) return "Trim Hit";
  if (has("reassess_due")) return "Reassess Due";
  if (has("entry_zone_reached")) return "In Entry Zone";
  return stockType === "holding" ? "Holding" : "Watching";
}

/**
 * The dedup guard for `alert_log` inserts: `true` if `lastTriggeredAt` (the
 * `triggered_at` of the most recent existing `alert_log` row for this
 * `(stock_id, trigger_type)` pair) is recent enough that a new row for the
 * same pair should be SKIPPED. Prevents a persistently-breached condition
 * (e.g. an unresolved stop-loss breach) from writing a fresh identical
 * `alert_log` row — and re-appearing in the next digest email — on every
 * 15-30 minute `poll-prices` cycle.
 *
 * `windowHours` defaults to 20 (per task-11-brief.md: "triggered within the
 * last 20 hours"), chosen to be longer than one calendar day's polling
 * window but short enough that a condition which persists across a full
 * trading-day gap (e.g. a stop breached at close, still breached at next
 * day's open) logs again rather than staying silent indefinitely.
 */
export function isWithinDedupWindow(
  lastTriggeredAt: string | Date,
  now: Date,
  windowHours = 20,
): boolean {
  const last =
    typeof lastTriggeredAt === "string"
      ? new Date(lastTriggeredAt)
      : lastTriggeredAt;
  const diffMs = now.getTime() - last.getTime();
  return diffMs < windowHours * 60 * 60 * 1000;
}
