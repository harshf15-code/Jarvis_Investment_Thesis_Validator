import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { computeWeightedAverageEntry } from "@/lib/weighted-average";
import { createClient } from "@/lib/supabase/server";

const AddEntrySchema = z.object({
  date: z.string().date(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  tranche: z.enum(["T1", "T2", "add"]),
  notes: z.string().trim().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: positionId } = await params;
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AddEntrySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data: entry, error: insertError } = await supabase
    .from("entries")
    .insert({ position_id: positionId, ...parsed.data })
    .select("*")
    .single();

  if (insertError || !entry) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to insert entry" },
      { status: 500 },
    );
  }

  const { data: allEntries, error: entriesError } = await supabase
    .from("entries")
    .select("quantity, price")
    .eq("position_id", positionId);

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 });
  }

  const weightedAverage = computeWeightedAverageEntry(allEntries ?? []);

  return NextResponse.json({ entry, weightedAverage }, { status: 201 });
}
