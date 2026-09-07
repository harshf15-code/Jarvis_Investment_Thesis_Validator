// app/api/signals/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { readSignalFeed } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { IntelligenceSignalInsert } from "@/lib/types";

const CreateSignalSchema = z.object({
  priority: z.enum(["red", "amber", "blue", "grey"]),
  headline: z.string().trim().min(1),
  ticker: z.string().trim().optional(),
  theme: z.string().trim().optional(),
  thesis_id: z.string().optional(),
});

/**
 * The feed, for the BROWSER.
 *
 * `/feed` itself reads through `readSignalFeed` on the server — see
 * `lib/queries.ts`. This route is what the client calls back through after it
 * archives a signal or adds one.
 */
export async function GET() {
  const supabase = await createClient();
  try {
    return NextResponse.json(await readSignalFeed(supabase));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the feed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = CreateSignalSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

  const supabase = await createClient();
  const insert: IntelligenceSignalInsert = parsed.data;
  const { data: signal, error } = await supabase.from("intelligence_signals").insert(insert).select("*").single();
  if (error || !signal) return NextResponse.json({ error: error?.message ?? "Failed to create signal" }, { status: 500 });
  return NextResponse.json({ signal }, { status: 201 });
}
