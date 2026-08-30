import { NextResponse } from "next/server";

import { CouncilMemberInputSchema, COUNCIL_ROSTER_MAX } from "@/lib/jarvis-council";
import { createClient } from "@/lib/supabase/server";
import { listCouncilMembers } from "@/lib/queries";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The caller's own roster. RLS scopes it; no filter is needed here. */
export async function GET() {
  try {
    return NextResponse.json({ members: await listCouncilMembers() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Adds a custom council member.
 *
 * The 7-member cap is checked here AND enforced by a trigger in 0017. This
 * check exists only to turn a Postgres exception into a sentence the trader can
 * act on; the trigger is what actually holds the line.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = CouncilMemberInputSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from("council_members")
    .select("id", { count: "exact", head: true });
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= COUNCIL_ROSTER_MAX) {
    return NextResponse.json(
      {
        error: `Your roster is full at ${COUNCIL_ROSTER_MAX} members. Remove one before adding another.`,
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("council_members")
    .insert({ name: parsed.data.name, philosophy: parsed.data.philosophy })
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not add member" }, { status: 500 });
  }

  return NextResponse.json({ member: data }, { status: 201 });
}
