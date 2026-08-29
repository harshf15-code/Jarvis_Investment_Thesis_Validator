import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ThesisUpdate } from "@/lib/types";

/**
 * The thesis-detail read path: the thesis itself, its single trade plan (if
 * one has been locked yet), and the linked stock's price snapshot. `stock` is
 * `null` for a Macro Thesis, which has no `stock_id`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

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
  /**
   * Resolves a macro thesis onto one of its bake-off candidates. The client
   * sends only the candidate id; `ticker` and `stock_id` are copied from that
   * row server-side rather than trusted from the request, so the thesis can
   * never end up pointing at a ticker the bake-off never actually priced.
   */
  selected_candidate_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateThesisSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = await createClient();

  const { selected_candidate_id, ...rest } = parsed.data;
  const patch: ThesisUpdate = { ...rest };

  if (selected_candidate_id !== undefined) {
    patch.selected_candidate_id = selected_candidate_id;
    if (selected_candidate_id === null) {
      patch.ticker = null;
      patch.stock_id = null;
    } else {
      const { data: candidate, error: candidateError } = await supabase
        .from("thesis_candidates")
        .select("ticker, stock_id, thesis_id")
        .eq("id", selected_candidate_id)
        .single();
      if (candidateError || !candidate) {
        return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
      }
      if (candidate.thesis_id !== id) {
        return NextResponse.json(
          { error: "Candidate belongs to a different thesis" },
          { status: 400 },
        );
      }
      patch.ticker = candidate.ticker;
      patch.stock_id = candidate.stock_id;
    }
  }

  const { data: thesis, error } = await supabase
    .from("theses")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }
  return NextResponse.json({ thesis });
}
