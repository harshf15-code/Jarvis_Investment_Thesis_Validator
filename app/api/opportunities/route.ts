// app/api/opportunities/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { OpportunityInsert } from "@/lib/types";

const CreateOpportunitySchema = z.object({
  ticker: z.string().trim().min(1),
  market: z.enum(["NSE", "BSE", "US"]),
  sector: z.string().optional(),
  conviction_tier: z.enum(["I", "II", "III", "IV"]).optional(),
  thesis_summary: z.string().optional(),
  pe: z.number().optional(),
  sector_median_pe: z.number().optional(),
  fifty_two_week_low: z.number().optional(),
  fifty_two_week_high: z.number().optional(),
  watching_only: z.boolean().optional(),
});

/** Spec US-20/US-21. Resolves each row's CMP + HELD/DRAFT badges by cross-referencing `stocks`/`positions`/`theses` on `ticker` — no FK exists between `opportunities` and those tables (Decision #2's denormalized-ticker pattern). */
export async function GET() {
  const supabase = await createClient();

  const { data: opportunities, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("conviction_tier", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = opportunities ?? [];
  if (rows.length === 0) return NextResponse.json({ opportunities: [] });

  const tickers = [...new Set(rows.map((o) => o.ticker))];
  const [{ data: stocks }, { data: positions }, { data: theses }] = await Promise.all([
    supabase.from("stocks").select("ticker, exchange, last_price, last_price_at").in("ticker", tickers),
    supabase.from("positions").select("ticker").in("status", ["active", "partial_exit"]).in("ticker", tickers),
    supabase.from("theses").select("ticker, status").eq("status", "draft").in("ticker", tickers),
  ]);
  const stockByTicker = new Map((stocks ?? []).map((s) => [s.ticker, s]));
  const heldTickers = new Set((positions ?? []).map((p) => p.ticker));
  const draftTickers = new Set((theses ?? []).map((t) => t.ticker));

  const result = rows.map((o) => {
    const stock = stockByTicker.get(o.ticker);
    return {
      opportunity: o,
      currentPrice: stock?.last_price ?? null,
      lastPriceAt: stock?.last_price_at ?? null,
      held: heldTickers.has(o.ticker),
      draft: draftTickers.has(o.ticker),
    };
  });

  return NextResponse.json({ opportunities: result });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateOpportunitySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

  const supabase = await createClient();
  const insert: OpportunityInsert = parsed.data;
  const { data: opportunity, error } = await supabase.from("opportunities").insert(insert).select("*").single();
  if (error || !opportunity) return NextResponse.json({ error: error?.message ?? "Failed to create opportunity" }, { status: 500 });
  return NextResponse.json({ opportunity }, { status: 201 });
}
