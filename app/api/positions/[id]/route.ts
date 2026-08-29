import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Screen 5–6's single read: one position with everything the exit-discipline
 * view needs — its entries (weighted average), its exits (which ladder rungs
 * are already DONE), its trade plan (stop/targets/thesis conditions), its
 * thesis (invalidation condition) and its stock (price + exchange).
 *
 * Deliberately five parallel queries rather than one PostgREST embed: the
 * joins hang off `positions`' own FKs in three different directions, and the
 * flat `{ position, entries, exits, tradePlan, thesis, stock }` shape is what
 * the page actually consumes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .select("*")
    .eq("id", id)
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Position not found" }, { status: 404 });
  }

  const [{ data: entries }, { data: exits }, { data: tradePlan }, { data: thesis }, { data: stock }] =
    await Promise.all([
      supabase.from("entries").select("*").eq("position_id", id).order("date", { ascending: true }),
      supabase.from("exits").select("*").eq("position_id", id).order("date", { ascending: true }),
      supabase.from("trade_plans").select("*").eq("id", position.trade_plan_id).single(),
      supabase.from("theses").select("*").eq("id", position.thesis_id).single(),
      supabase.from("stocks").select("*").eq("id", position.stock_id).single(),
    ]);

  return NextResponse.json({
    position,
    entries: entries ?? [],
    exits: exits ?? [],
    tradePlan: tradePlan ?? null,
    thesis: thesis ?? null,
    stock: stock ?? null,
  });
}
