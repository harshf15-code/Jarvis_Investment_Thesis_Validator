import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { z } from "zod";

export async function GET() {
  const supabase = createAdminClient();

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("*")
    .eq("status", "active");
  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }
  if (!positions || positions.length === 0) {
    return NextResponse.json({ positions: [] });
  }

  const positionIds = positions.map((p) => p.id);
  const stockIds = [...new Set(positions.map((p) => p.stock_id))];
  const tradePlanIds = [...new Set(positions.map((p) => p.trade_plan_id))];
  const thesisIds = [...new Set(positions.map((p) => p.thesis_id))];

  const [{ data: entries }, { data: stocks }, { data: tradePlans }, { data: theses }] = await Promise.all([
    supabase.from("entries").select("*").in("position_id", positionIds),
    supabase.from("stocks").select("*").in("id", stockIds),
    supabase.from("trade_plans").select("*").in("id", tradePlanIds),
    supabase.from("theses").select("id, conviction_tier").in("id", thesisIds),
  ]);

  const entriesByPosition = new Map<string, { quantity: number; price: number }[]>();
  for (const e of entries ?? []) {
    const list = entriesByPosition.get(e.position_id) ?? [];
    list.push({ quantity: e.quantity, price: e.price });
    entriesByPosition.set(e.position_id, list);
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));
  const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));
  const thesisById = new Map((theses ?? []).map((t) => [t.id, t]));

  const result = positions.map((p) => {
    const stock = stockById.get(p.stock_id);
    const tradePlan = tradePlanById.get(p.trade_plan_id);
    const weightedAverage = computeWeightedAverageEntry(entriesByPosition.get(p.id) ?? []);
    return {
      position: p,
      stock,
      tradePlan,
      weightedAverage,
      convictionTier: thesisById.get(p.thesis_id)?.conviction_tier ?? undefined,
    };
  });

  return NextResponse.json({ positions: result });
}

const CreatePositionSchema = z.object({
  trade_plan_id: z.string().min(1),
  thesis_id: z.string().min(1),
  stock_id: z.string().min(1),
  ticker: z.string().min(1),
  date: z.string().date(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  tranche: z.enum(["T1", "T2", "add"]),
  jarvis_recommendation_id: z.string().optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreatePositionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { jarvis_recommendation_id, date, quantity, price, tranche, ...positionFields } = parsed.data;

  const supabase = createAdminClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert(positionFields)
    .select("*")
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Failed to create position" }, { status: 500 });
  }

  const { error: entryError } = await supabase
    .from("entries")
    .insert({ position_id: position.id, date, quantity, price, tranche });
  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }

  if (jarvis_recommendation_id) {
    const { error: recError } = await supabase
      .from("jarvis_recommendations")
      .update({ converted_to_position: true, position_id: position.id })
      .eq("id", jarvis_recommendation_id);
    if (recError) {
      return NextResponse.json({ error: recError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ position }, { status: 201 });
}
