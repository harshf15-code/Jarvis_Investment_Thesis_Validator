import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = createAdminClient();

  const { data: recommendations, error } = await supabase
    .from("jarvis_recommendations")
    .select("*")
    .order("recommended_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!recommendations || recommendations.length === 0) {
    return NextResponse.json({ recommendations: [] });
  }

  const stockIds = [...new Set(recommendations.map((r) => r.stock_id))];
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("id, last_price, exchange")
    .in("id", stockIds);
  if (stocksError) {
    return NextResponse.json({ error: stocksError.message }, { status: 500 });
  }
  const stockById = new Map((stocks ?? []).map((s) => [s.id, s]));

  const result = recommendations.map((rec) => ({
    recommendation: rec,
    stock: stockById.get(rec.stock_id),
  }));

  return NextResponse.json({ recommendations: result });
}
