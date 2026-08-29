import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const EDITABLE_FIELDS = [
  "entry_zone_low", "entry_zone_high", "add_tranche_low", "add_tranche_high",
  "stop_loss", "target_1", "target_2", "position_size_pct", "max_portfolio_pct",
  "time_exit_date", "time_exit_condition",
] as const;

const UpdateTradePlanSchema = z
  .object({
    ...Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, z.union([z.number(), z.string()]).nullable().optional()])),
    /** US-15 (Task 23): user-owned, never AI-suggested — kept out of `EDITABLE_FIELDS` so it never enters the `edited_fields` diff. */
    thesis_conditions: z
      .array(z.object({ label: z.string(), target: z.string(), currentValue: z.string() }))
      .optional(),
  })
  .strict();

/** Spec US-07: inline edits auto-save on blur; edited fields show an amber underline (diff from `ai_suggested`) until "Reset to AI suggestion". */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateTradePlanSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("trade_plans")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError || !existing) {
    return NextResponse.json({ error: fetchError?.message ?? "Trade plan not found" }, { status: 404 });
  }

  // `thesis_conditions` is split out before the diff loop: it has no
  // `ai_suggested` counterpart to diff against, and marking it "edited" would
  // put an amber "edited from AI's suggestion" underline on a field the AI
  // never suggested.
  const { thesis_conditions, ...editableData } = parsed.data;

  const aiSuggested = (existing.ai_suggested ?? {}) as Record<string, unknown>;
  const existingEditedFields = new Set<string>(existing.edited_fields ?? []);
  for (const [field, value] of Object.entries(editableData)) {
    if (value === undefined) continue;
    if (field in aiSuggested && aiSuggested[field] === value) {
      existingEditedFields.delete(field);
    } else {
      existingEditedFields.add(field);
    }
  }

  const { data: tradePlan, error: updateError } = await supabase
    .from("trade_plans")
    .update({
      ...editableData,
      ...(thesis_conditions !== undefined ? { thesis_conditions } : {}),
      edited_fields: [...existingEditedFields],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError || !tradePlan) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to update trade plan" }, { status: 500 });
  }
  return NextResponse.json({ tradePlan });
}
