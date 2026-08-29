// app/api/signals/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Spec US-08's "archived (moves to Reviewed tab with timestamp)." */
export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: signal, error } = await supabase
    .from("intelligence_signals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !signal) return NextResponse.json({ error: error?.message ?? "Signal not found" }, { status: 404 });
  return NextResponse.json({ signal });
}
