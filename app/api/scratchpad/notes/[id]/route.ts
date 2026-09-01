import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ScratchpadNoteUpdate } from "@/lib/types";

/**
 * Edit or archive one note.
 *
 * There is no DELETE, deliberately. A note is a record of what the trader was
 * thinking, and "I stopped believing this" is part of that record — archiving
 * takes it off the list without destroying it. `archived: false` puts it back.
 */

const UpdateSchema = z
  .object({
    body: z.string().trim().min(1, "Write something, or archive it instead.").max(4000).optional(),
    ticker: z
      .string()
      .trim()
      .max(24)
      .transform((t) => (t === "" ? null : t.toUpperCase()))
      .nullable()
      .optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const json = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const { archived, ...fields } = parsed.data;
  const patch: ScratchpadNoteUpdate = { ...fields, updated_at: new Date().toISOString() };
  if (archived !== undefined) {
    patch.archived_at = archived ? new Date().toISOString() : null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scratchpad_notes")
    .update(patch)
    .eq("id", id)
    // RLS makes somebody else's note invisible rather than forbidden, so "not
    // yours" and "does not exist" are the same 404 — which is the answer that
    // leaks the least.
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }
  return NextResponse.json({ note: data });
}
