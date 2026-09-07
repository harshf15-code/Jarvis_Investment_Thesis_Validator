// app/api/opportunities/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { readOpportunities } from "@/lib/queries";
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

/**
 * The watchlist, for the BROWSER.
 *
 * `/discovery` reads through `readOpportunities` on the server — see
 * `lib/queries.ts`. This route is what the Add-to-Watchlist modal calls back
 * through.
 */
export async function GET() {
  const supabase = await createClient();
  try {
    return NextResponse.json({ opportunities: await readOpportunities(supabase) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the watchlist." },
      { status: 500 },
    );
  }
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
