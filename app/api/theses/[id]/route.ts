import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The thesis-detail read path: the thesis itself, its single trade plan (if
 * one has been locked yet), and the linked stock's price snapshot. `stock` is
 * `null` for a Macro Thesis, which has no `stock_id`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: thesis, error } = await supabase.from("theses").select("*").eq("id", id).single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }

  const { data: tradePlan } = await supabase
    .from("trade_plans")
    .select("*")
    .eq("thesis_id", id)
    .maybeSingle();

  const { data: stock } = thesis.stock_id
    ? await supabase
        .from("stocks")
        .select("exchange, last_price, last_price_at")
        .eq("id", thesis.stock_id)
        .single()
    : { data: null };

  return NextResponse.json({ thesis, tradePlan: tradePlan ?? null, stock: stock ?? null });
}

const UpdateThesisSchema = z.object({
  status: z.enum(["draft", "active", "closed", "macro"]).optional(),
  bear_cases: z
    .array(z.object({ reason: z.string(), counter: z.string(), modified: z.boolean() }))
    .optional(),
  conviction_score: z.number().min(0).max(100).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateThesisSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: thesis, error } = await supabase
    .from("theses")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }
  return NextResponse.json({ thesis });
}
