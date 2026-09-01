import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The Scratchpad's notes — plain CRUD, no model call, no budget check.
 *
 * A place to write an idea down before it is a thesis. `ticker` is free text
 * and optional on purpose: an idea can name something the app has never
 * resolved, or nothing at all.
 */

const NOTE_LIMIT = 200;

const CreateSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(4000),
  ticker: z
    .string()
    .trim()
    .max(24)
    .transform((t) => (t === "" ? null : t.toUpperCase()))
    .nullable()
    .default(null),
});

/**
 * Every note, archived ones included, newest first.
 *
 * One request rather than two. The archive view and the ticker filter are both
 * views onto the same small list, so making either of them cost a round trip
 * would be paying for nothing.
 */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scratchpad_notes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(NOTE_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scratchpad_notes")
    .insert({ body: parsed.data.body, ticker: parsed.data.ticker })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ note: data }, { status: 201 });
}
