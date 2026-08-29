import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listOpenPositions } from "@/lib/queries";
import { z } from "zod";

export async function GET() {
  try {
    return NextResponse.json({ positions: await listOpenPositions() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
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

  const supabase = await createClient();

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
