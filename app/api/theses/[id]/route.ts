import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const UpdateThesisSchema = z.object({
  status: z.enum(["draft", "active", "closed", "macro"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = UpdateThesisSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: thesis, error } = await supabase
    .from("theses")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !thesis) {
    return NextResponse.json({ error: error?.message ?? "Thesis not found" }, { status: 404 });
  }
  return NextResponse.json({ thesis });
}
