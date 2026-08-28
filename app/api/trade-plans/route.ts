import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ConvictionTier, JarvisRecommendationInsert, Json, TradePlanInsert } from "@/lib/types";

const CreateTradePlanSchema = z.object({
  thesis_id: z.string().min(1),
  entry_zone_low: z.number().nullable().optional(),
  entry_zone_high: z.number().nullable().optional(),
  add_tranche_low: z.number().nullable().optional(),
  add_tranche_high: z.number().nullable().optional(),
  stop_loss: z.number(),
  target_1: z.number().nullable().optional(),
  target_2: z.number().nullable().optional(),
  position_size_pct: z.number().nullable().optional(),
  max_portfolio_pct: z.number().nullable().optional(),
  time_exit_date: z.iso.date().nullable().optional(),
  time_exit_condition: z.string().nullable().optional(),
  /**
   * What Jarvis proposed before the trader edited it, from
   * `POST /api/theses/:id/trade-plan-draft`. Recorded so the review screen's
   * "Reset to AI suggestion" restores Jarvis's number rather than the number
   * that was submitted — which is what it did when this fell back to
   * `planFields`.
   */
  ai_suggested: z.record(z.string(), z.unknown()).nullable().optional(),
});

const RECOMMENDATION_TIERS: ConvictionTier[] = ["I", "II"];

/** Spec US-12's last bullet — the only writer of `trade_plans` and (conditionally) `jarvis_recommendations` in the app. A `jarvis_recommendations` row is created if and only if the thesis is Tier I or II (Screen NEW: "every time Jarvis generates a BUY recommendation... a JarvisRecommendation record is created automatically"); Tier III/IV plans exist but are never tracked. */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateTradePlanSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { thesis_id, ai_suggested, ...planFields } = parsed.data;

  const { data: thesis, error: thesisError } = await supabase
    .from("theses")
    .select("id, stock_id, ticker, conviction_tier")
    .eq("id", thesis_id)
    .single();
  if (thesisError || !thesis) {
    return NextResponse.json({ error: thesisError?.message ?? "Thesis not found" }, { status: 404 });
  }
  if (!thesis.stock_id) {
    return NextResponse.json(
      { error: "Cannot build a trade plan for a Macro Thesis with no stock." },
      { status: 400 },
    );
  }

  // A thesis has exactly one trade plan (`GET /api/theses/:id` reads it with
  // `.maybeSingle()`), so a second POST for the same thesis — a re-visit of
  // the wizard after locking — must not silently create a duplicate row that
  // would break every later read. The existing plan is edited via
  // `PATCH /api/trade-plans/:id` instead.
  const { data: existingPlan } = await supabase
    .from("trade_plans")
    .select("id")
    .eq("thesis_id", thesis_id)
    .maybeSingle();
  if (existingPlan) {
    return NextResponse.json(
      { error: "This thesis already has a locked trade plan.", tradePlanId: existingPlan.id },
      { status: 409 },
    );
  }

  const insert: TradePlanInsert = {
    thesis_id,
    ...planFields,
    ai_suggested: (ai_suggested ?? planFields) as Json,
    edited_fields: [],
  };

  const { data: tradePlan, error: insertError } = await supabase
    .from("trade_plans")
    .insert(insert)
    .select("*")
    .single();
  if (insertError || !tradePlan) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create trade plan" }, { status: 500 });
  }

  let recommendation = null;
  if (thesis.conviction_tier && RECOMMENDATION_TIERS.includes(thesis.conviction_tier)) {
    const { data: stock } = await supabase
      .from("stocks")
      .select("last_price")
      .eq("id", thesis.stock_id)
      .single();

    const recInsert: JarvisRecommendationInsert = {
      thesis_id,
      trade_plan_id: tradePlan.id,
      stock_id: thesis.stock_id,
      ticker: thesis.ticker ?? "",
      conviction_tier: thesis.conviction_tier,
      price_at_recommendation: stock?.last_price ?? 0,
      thesis_summary: `${thesis.ticker ?? "Macro"} — Tier ${thesis.conviction_tier} trade plan locked.`,
      recommended_entry_low: planFields.entry_zone_low ?? null,
      recommended_entry_high: planFields.entry_zone_high ?? null,
      recommended_stop: planFields.stop_loss,
      recommended_target_1: planFields.target_1 ?? null,
      recommended_target_2: planFields.target_2 ?? null,
    };

    const { data: rec, error: recError } = await supabase
      .from("jarvis_recommendations")
      .insert(recInsert)
      .select("*")
      .single();
    if (recError) {
      return NextResponse.json({ error: recError.message }, { status: 500 });
    }
    recommendation = rec;
  }

  return NextResponse.json({ tradePlan, recommendation }, { status: 201 });
}
