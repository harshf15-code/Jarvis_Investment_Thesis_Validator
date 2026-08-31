import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { WATCH_BATCH, WATCH_INTERVAL_DAYS } from "@/lib/holding-watch";
import { reviewHolding } from "@/lib/portfolio/holding-review";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The scheduled per-holding watch. Drains a slice of holdings that are due.
 *
 * WHY THIS IS A NEXT ROUTE AND NOT AN EDGE FUNCTION. Every other scheduled job
 * here is a Deno Edge Function, and this one deliberately is not. Deno cannot
 * import `lib/llm/*`, so an Edge Function that made model calls would have to
 * reimplement metering, budget checking and cost attribution alongside the
 * originals — and a second implementation of a spend ledger is a second answer
 * to "what has this cost", which is the one question the ledger exists to
 * answer. `pg_cron` calls this over HTTP instead, the same way it calls the
 * Edge Functions, with the secret read from Vault.
 *
 * WHY IT RUNS HOURLY FOR A WEEKLY WATCH. `WATCH_INTERVAL_DAYS` is the cadence
 * a HOLDING is re-read at; `WATCH_BATCH` is how many are taken per call. A
 * frequent small drain keeps each invocation inside one function timeout
 * however large the book grows, where one weekly run over every holding would
 * not. A holding that misses its slot is simply older next hour, and the query
 * is ordered oldest-first, so nothing starves.
 */
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const expected = process.env.HOLDING_WATCH_SECRET;
  // No secret configured means the job is not deployed. Refuse rather than
  // run: an unauthenticated route that spends model calls for every account on
  // the instance is not something to fail open on.
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // one bit; compare lengths first and always run the comparison.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const due = new Date(Date.now() - WATCH_INTERVAL_DAYS * 86_400_000).toISOString();

  // Never-checked rows first (`nulls first` in the index), then oldest. The
  // filter is `is null OR older than the interval`, which PostgREST expresses
  // as an `or`.
  const { data: pending, error } = await supabase
    .from("holding_watch_state")
    .select("position_id, user_id, last_checked_at")
    .or(`last_checked_at.is.null,last_checked_at.lt.${due}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(WATCH_BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ checked: 0, reviewed: 0, unchanged: 0, skipped: 0, failed: 0 });
  }

  // Only positions still open, on theses that were imported. v1 scopes the
  // watch to imported holdings per the PRD; the table is keyed by position_id
  // rather than by source so widening it later is a query change, not a
  // migration.
  const { data: eligible } = await supabase
    .from("positions")
    .select("id, thesis_id, theses!inner(source)")
    .in(
      "id",
      pending.map((p) => p.position_id),
    )
    // `poll-prices` uses `.eq("status","active")` and so silently skips
    // partially-trimmed positions. A holding you have trimmed once is still a
    // holding you want watched.
    .in("status", ["active", "partial_exit"])
    .eq("theses.source", "imported");

  const eligibleIds = new Set((eligible ?? []).map((p) => p.id));

  const tally = { checked: 0, reviewed: 0, unchanged: 0, skipped: 0, failed: 0 };
  const flagged: string[] = [];

  // Sequential on purpose. Each iteration can make a model call, and running
  // 25 of those concurrently would spend a slice of the daily cap faster than
  // `checkBudget` — a pre-flight, not a reservation — can observe it.
  for (const row of pending) {
    if (!eligibleIds.has(row.position_id)) {
      // Closed, or no longer an imported holding. Drop it from the queue so it
      // stops being drained forever.
      await supabase.from("holding_watch_state").delete().eq("position_id", row.position_id);
      continue;
    }
    tally.checked += 1;
    try {
      const outcome = await reviewHolding({
        supabase,
        userId: row.user_id,
        positionId: row.position_id,
        force: false,
      });
      if (outcome.status === "reviewed") {
        tally.reviewed += 1;
        if (outcome.flagged) flagged.push(row.position_id);
      } else if (outcome.status === "unchanged") {
        tally.unchanged += 1;
      } else if (outcome.status === "skipped") {
        tally.skipped += 1;
      } else {
        tally.failed += 1;
        console.error(`[holding-watch] ${row.position_id}: ${outcome.error}`);
      }
    } catch (err) {
      // One bad symbol must not abort the slice — the remaining holdings in
      // this batch have nothing to do with it.
      tally.failed += 1;
      console.error(`[holding-watch] ${row.position_id} threw:`, err);
    }
  }

  return NextResponse.json({ ...tally, flagged: flagged.length });
}
