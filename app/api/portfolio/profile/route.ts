import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The trader's stated goal for the book as a whole.
 *
 * Nothing reads it yet. It is collected during the CSV import because that is
 * the one moment a trader is already thinking about their portfolio as a
 * portfolio; asking later means never. A portfolio-level Council is what will
 * judge structure against it.
 */

const ProfileSchema = z.object({
  objective: z.string().trim().max(2000).nullable(),
});

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_profiles")
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // `null` means "never asked", which is what the import flow branches on.
  return NextResponse.json({ profile: data ?? null });
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = ProfileSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_profiles")
    .upsert({ objective: parsed.data.objective, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}
