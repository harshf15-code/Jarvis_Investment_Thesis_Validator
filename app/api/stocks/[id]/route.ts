import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Holding, HoldingUpdate, StockUpdate } from "@/lib/types";
import { UpdateStockInputSchema } from "@/lib/validation/schemas";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/stocks/[id] — partial update. Supports:
 * - Toggling `type` to `"holding"`: requires the holding fields in the same
 *   request (enforced by `UpdateStockInputSchema`) and upserts the
 *   `holdings` row.
 * - Toggling `type` to `"watchlist"`: deletes the `holdings` row for real
 *   (not soft-deleted — `holdings` is 1:1 owned metadata on the stock, not
 *   a user-visible entity with its own lifecycle; the `stocks` row itself
 *   stays and only loses its holding-specific data).
 * - Updating holding fields directly (no `type` in the body) when the stock
 *   is already a holding.
 * - Any other direct `stocks` column present in the body (currently just
 *   `deleted_at`, included in the schema for completeness — the dedicated
 *   soft-delete path is `DELETE /api/stocks/[id]`).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateStockInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from("stocks")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  if (input.type === "holding") {
    // UpdateStockInputSchema guarantees these are present when type is
    // "holding" in the request body.
    const holdingUpsert = {
      stock_id: id,
      shares: input.shares as number,
      cost_basis: input.cost_basis as number,
      date_acquired: input.date_acquired as string,
    };

    const { error: upsertError } = await supabase
      .from("holdings")
      .upsert(holdingUpsert, { onConflict: "stock_id" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  } else if (input.type === "watchlist") {
    const { error: deleteHoldingError } = await supabase
      .from("holdings")
      .delete()
      .eq("stock_id", id);

    if (deleteHoldingError) {
      return NextResponse.json(
        { error: deleteHoldingError.message },
        { status: 500 },
      );
    }
  } else if (
    input.shares !== undefined ||
    input.cost_basis !== undefined ||
    input.date_acquired !== undefined
  ) {
    if (existing.type !== "holding") {
      return NextResponse.json(
        {
          error:
            'Cannot update holding fields on a watchlist entry; include type: "holding" to convert it first.',
        },
        { status: 400 },
      );
    }

    const holdingUpdate: HoldingUpdate = {};
    if (input.shares !== undefined) holdingUpdate.shares = input.shares;
    if (input.cost_basis !== undefined) holdingUpdate.cost_basis = input.cost_basis;
    if (input.date_acquired !== undefined) {
      holdingUpdate.date_acquired = input.date_acquired;
    }

    const { error: holdingUpdateError } = await supabase
      .from("holdings")
      .update(holdingUpdate)
      .eq("stock_id", id);

    if (holdingUpdateError) {
      return NextResponse.json(
        { error: holdingUpdateError.message },
        { status: 500 },
      );
    }
  }

  const stockUpdate: StockUpdate = {};
  if (input.type !== undefined) stockUpdate.type = input.type;
  if (input.deleted_at !== undefined) stockUpdate.deleted_at = input.deleted_at;

  if (Object.keys(stockUpdate).length > 0) {
    const { error: stockUpdateError } = await supabase
      .from("stocks")
      .update(stockUpdate)
      .eq("id", id);

    if (stockUpdateError) {
      return NextResponse.json(
        { error: stockUpdateError.message },
        { status: 500 },
      );
    }
  }

  const { data: updated, error: refetchError } = await supabase
    .from("stocks")
    .select("*")
    .eq("id", id)
    .single();

  if (refetchError || !updated) {
    return NextResponse.json(
      { error: refetchError?.message ?? "Failed to refetch stock" },
      { status: 500 },
    );
  }

  const { data: holdingRow } = await supabase
    .from("holdings")
    .select("*")
    .eq("stock_id", id)
    .maybeSingle();

  const holding: Holding | null = holdingRow ?? null;

  return NextResponse.json({ ...updated, holding });
}

/**
 * DELETE /api/stocks/[id] — soft delete only. Sets `deleted_at = now()`;
 * never issues a real `DELETE` against the `stocks` row (unlike the
 * orphan-holding cleanup in `POST /api/stocks`, which deletes a row that
 * never finished being created — this endpoint always operates on an
 * already-complete, user-visible entry).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from("stocks")
    .select("id, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing || existing.deleted_at !== null) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("stocks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
