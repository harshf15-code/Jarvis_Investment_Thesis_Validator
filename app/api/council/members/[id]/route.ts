import { NextResponse } from "next/server";

import { CouncilMemberInputSchema } from "@/lib/jarvis-council";
import { createClient } from "@/lib/supabase/server";

/**
 * Edits a council member — built-in or custom alike.
 *
 * `source` is deliberately not editable and deliberately not a guard: a
 * built-in is an ordinary row the trader owns. It stays labelled `builtin` so
 * the roster can say where it came from, but nothing about it is protected.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = CouncilMemberInputSchema.partial().safeParse(json ?? {});
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: parsed.success ? "Nothing to update" : parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("council_members")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Council member not found" }, { status: 404 });
  }

  return NextResponse.json({ member: data });
}

/**
 * Removes a member, including a built-in.
 *
 * The roster caps at 7 TOTAL, so a trader who wants four voices of their own
 * has to be able to free a slot. A hidden-but-present state would be a second
 * thing to model for no benefit — and deletion is permanent: 0017's seed only
 * runs for an account with an empty roster, so the built-ins do not come back.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("council_members")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Council member not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
