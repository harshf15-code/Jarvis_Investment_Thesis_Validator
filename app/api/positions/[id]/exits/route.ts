import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const AddExitSchema = z
  .object({
    date: z.iso.date(),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().positive(),
    type: z.enum(["trim_t1", "trim_t2", "stop_hit", "time_exit", "manual"]),
    reason: z.string().trim().optional(),
    override: z.boolean().optional(),
    override_reason: z.string().trim().optional(),
  })
  /** Spec US-17: an override reason, when provided, must be at least 40 characters — the deliberate friction that makes a discipline break require actually explaining itself. */
  .refine((data) => !data.override || (data.override_reason?.length ?? 0) >= 40, {
    message: "override_reason must be at least 40 characters when override is true",
    path: ["override_reason"],
  });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: positionId } = await params;
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = AddExitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch entries and pre-existing exits before inserting the new one, so the
  // running total is `priorExits + thisExit` rather than a second read of
  // `exits` after the insert (which would double as a race-prone extra
  // round trip for no benefit — this request already knows the quantity it
  // just wrote).
  const [{ data: entries, error: entriesError }, { data: existingExits, error: exitsError }] = await Promise.all([
    supabase.from("entries").select("quantity").eq("position_id", positionId),
    supabase.from("exits").select("quantity").eq("position_id", positionId),
  ]);
  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 });
  if (exitsError) return NextResponse.json({ error: exitsError.message }, { status: 500 });

  const totalEntered = (entries ?? []).reduce((sum, e) => sum + e.quantity, 0);
  const totalExitedBefore = (existingExits ?? []).reduce((sum, e) => sum + e.quantity, 0);
  const quantityRemainingBeforeThisExit = totalEntered - totalExitedBefore;

  // Reject an overshoot before writing anything: a negative remainingQuantity
  // would still mark the position "closed" but leave a permanently wrong
  // exits row and a negative number in a UI that renders it directly
  // (Task 23's "Quantity (full remaining)" field).
  if (parsed.data.quantity > quantityRemainingBeforeThisExit) {
    return NextResponse.json(
      {
        error: `Exit quantity (${parsed.data.quantity}) exceeds the ${quantityRemainingBeforeThisExit} shares remaining on this position`,
      },
      { status: 400 },
    );
  }

  const { data: exit, error: insertError } = await supabase
    .from("exits")
    .insert({ position_id: positionId, ...parsed.data })
    .select("*")
    .single();
  if (insertError || !exit) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to insert exit" }, { status: 500 });
  }

  const remainingQuantity = quantityRemainingBeforeThisExit - parsed.data.quantity;
  const positionStatus = remainingQuantity <= 0 ? "closed" : "partial_exit";

  const { error: updateError } = await supabase
    .from("positions")
    .update({ status: positionStatus })
    .eq("id", positionId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(
    { exit, remainingQuantity, positionStatus, promptJournal: remainingQuantity <= 0 },
    { status: 201 },
  );
}
