import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { FundamentalInsert } from "@/lib/types";
import { UpsertFundamentalInputSchema } from "@/lib/validation/schemas";

type RouteParams = { params: Promise<{ stockId: string }> };

/**
 * PATCH/DELETE for one stock's user-tracked ("manual") `fundamentals` rows.
 * Detail-page-scoped (Task 9), not folded into Task 5's `/api/stocks`
 * routes: the auto-pulled (`source = 'auto'`) rows are written by the
 * Jarvis run route / a later Edge Function, never by this endpoint.
 */

async function stockExists(
  supabase: ReturnType<typeof createAdminClient>,
  stockId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("stocks")
    .select("id")
    .eq("id", stockId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data !== null;
}

/**
 * Looks up the existing `fundamentals` row (if any) for `(stockId,
 * metricKey)`, so `PATCH` can tell an "editing/creating a manual metric"
 * upsert apart from one that would silently clobber an auto-pulled row that
 * happens to share the same key.
 */
async function findExistingSource(
  supabase: ReturnType<typeof createAdminClient>,
  stockId: string,
  metricKey: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("fundamentals")
    .select("source")
    .eq("stock_id", stockId)
    .eq("metric_key", metricKey)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data?.source ?? null;
}

/**
 * PATCH /api/fundamentals/[stockId] — upsert-by-`metric_key`. Always writes
 * `source: 'manual'`: this is the only write path for user-tracked metrics,
 * and `fundamentals` has a `unique (stock_id, metric_key)` constraint
 * (`supabase/migrations/0001_init.sql`), so this both adds a brand-new
 * metric and edits an existing one through the same call.
 *
 * Guards against key collisions with an auto-pulled row: if a `source =
 * 'auto'` row already exists for this `(stock_id, metric_key)`, the upsert
 * is rejected with 409 rather than silently converting that row to
 * `source = 'manual'` and overwriting its value (the `unique (stock_id,
 * metric_key)` constraint has no `source` component, so nothing at the DB
 * level would otherwise stop that). Not currently reachable in this
 * codebase — nothing writes `source = 'auto'` rows yet — but the guard
 * closes the gap now rather than waiting for a future task's auto-writer to
 * make it exploitable.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { stockId } = await params;

  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpsertFundamentalInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  let exists: boolean;
  try {
    exists = await stockExists(supabase, stockId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!exists) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  let existingSource: string | null;
  try {
    existingSource = await findExistingSource(
      supabase,
      stockId,
      parsed.data.metric_key,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (existingSource === "auto") {
    return NextResponse.json(
      {
        error:
          "A metric with this key already exists as an auto-pulled value — choose a different key",
      },
      { status: 409 },
    );
  }

  const insert: FundamentalInsert = {
    stock_id: stockId,
    metric_key: parsed.data.metric_key,
    metric_value: parsed.data.metric_value,
    source: "manual",
    updated_at: new Date().toISOString(),
  };

  const { data: upserted, error: upsertError } = await supabase
    .from("fundamentals")
    .upsert(insert, { onConflict: "stock_id,metric_key" })
    .select("*")
    .single();

  if (upsertError || !upserted) {
    return NextResponse.json(
      { error: upsertError?.message ?? "Failed to upsert fundamental" },
      { status: 500 },
    );
  }

  return NextResponse.json(upserted);
}

/**
 * DELETE /api/fundamentals/[stockId]?key=<metric_key> — removes one
 * user-tracked metric. Scoped to `source = 'manual'` so this can never be
 * used to delete an auto-pulled row, even if a client sent a key that
 * happens to collide with one.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { stockId } = await params;
  const metricKey = request.nextUrl.searchParams.get("key");

  if (!metricKey) {
    return NextResponse.json(
      { error: "Query parameter 'key' is required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  let exists: boolean;
  try {
    exists = await stockExists(supabase, stockId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!exists) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("fundamentals")
    .delete()
    .eq("stock_id", stockId)
    .eq("metric_key", metricKey)
    .eq("source", "manual");

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
