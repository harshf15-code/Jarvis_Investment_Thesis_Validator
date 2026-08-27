// app/api/signals/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { IntelligenceSignalInsert } from "@/lib/types";

const PRIORITY_ORDER: Record<string, number> = { red: 0, amber: 1, blue: 2, grey: 3 };

const CreateSignalSchema = z.object({
  priority: z.enum(["red", "amber", "blue", "grey"]),
  headline: z.string().trim().min(1),
  ticker: z.string().trim().optional(),
  theme: z.string().trim().optional(),
  thesis_id: z.string().optional(),
});

/** Spec US-08: sorted RED -> AMBER -> BLUE -> GREY, then recency within each tier. Also returns the "Today's Agenda" 14-day time-exit list. */
export async function GET() {
  const supabase = createAdminClient();

  const { data: signals, error } = await supabase
    .from("intelligence_signals")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = [...(signals ?? [])].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Today's Agenda is a supplementary sidebar computation layered onto the
  // same response; a failure here should never take down the signals feed
  // itself, so it degrades to an empty agenda rather than throwing.
  let agenda: { ticker: string; timeExitDate: string | null }[] = [];
  try {
    const { data: positions } = await supabase
      .from("positions")
      .select("id, ticker, trade_plan_id")
      .in("status", ["active", "partial_exit"]);
    const tradePlanIds = [...new Set((positions ?? []).map((p) => p.trade_plan_id))];
    const { data: tradePlans } = tradePlanIds.length
      ? await supabase.from("trade_plans").select("id, time_exit_date").in("id", tradePlanIds)
      : { data: [] };
    const tradePlanById = new Map((tradePlans ?? []).map((t) => [t.id, t]));

    agenda = (positions ?? [])
      .map((p) => ({ ticker: p.ticker, timeExitDate: tradePlanById.get(p.trade_plan_id)?.time_exit_date ?? null }))
      .filter((a) => a.timeExitDate !== null && a.timeExitDate >= today && a.timeExitDate <= in14Days)
      .sort((a, b) => a.timeExitDate!.localeCompare(b.timeExitDate!));
  } catch {
    agenda = [];
  }

  return NextResponse.json({ signals: sorted, agenda });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateSignalSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();
  const insert: IntelligenceSignalInsert = parsed.data;
  const { data: signal, error } = await supabase.from("intelligence_signals").insert(insert).select("*").single();
  if (error || !signal) return NextResponse.json({ error: error?.message ?? "Failed to create signal" }, { status: 500 });
  return NextResponse.json({ signal }, { status: 201 });
}
