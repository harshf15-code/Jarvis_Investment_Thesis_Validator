import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { requirePortfolioScope } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";

/**
 * The Scratchpad's notes — plain CRUD, no model call, no budget check.
 *
 * A place to write an idea down before it is a thesis. `ticker` is free text
 * and optional on purpose: an idea can name something the app has never
 * resolved, or nothing at all.
 *
 * Scoped to one book since 0027. A note is written while looking at a
 * particular portfolio and reads as a thought about that book, so blending five
 * books worth of notes into one list would lose the thing that made each of
 * them make sense.
 */

const NOTE_LIMIT = 200;

const CreateSchema = z.object({
  portfolio_id: z.string().uuid("Choose which portfolio this note belongs to."),
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
 *
 * That trade only holds while the list is small, so the cap is reported rather
 * than applied in silence: one extra row is fetched purely to find out whether
 * more exist, and `truncated` tells the UI to say so. A scratchpad that has
 * outgrown one page needs a cursor and a server-side filter, and the honest
 * thing until then is to admit the older notes are not on screen instead of
 * letting them quietly disappear.
 */
export async function GET(request: Request) {
  const scope = requirePortfolioScope(request);
  if (scope instanceof Response) return scope;

  const supabase = await createClient();
  let query = supabase.from("scratchpad_notes").select("*");
  // The roll-up reads every book: notes are the trader's own words either way,
  // and hiding them behind a book choice would make the all-portfolios view
  // less informative than any single one.
  if (scope.mode === "one") query = query.eq("portfolio_id", scope.id);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(NOTE_LIMIT + 1);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = data ?? [];
  return NextResponse.json({
    notes: rows.slice(0, NOTE_LIMIT),
    truncated: rows.length > NOTE_LIMIT,
  });
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
    .insert({
      // A foreign portfolio_id cannot get through: 0027 keys the foreign key on
      // (portfolio_id, user_id), so the pair has to be a book this trader owns.
      portfolio_id: parsed.data.portfolio_id,
      body: parsed.data.body,
      ticker: parsed.data.ticker,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ note: data }, { status: 201 });
}
