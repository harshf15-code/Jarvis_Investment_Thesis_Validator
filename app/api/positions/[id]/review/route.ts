import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { reviewHolding } from "@/lib/portfolio/holding-review";
import { createClient } from "@/lib/supabase/server";

/**
 * "Re-run this read" from the position page.
 *
 * Runs the same `reviewHolding` the scheduled watch runs, with `force` — a
 * trader who asks gets an answer whether or not a fundamental moved, which is
 * the one difference between the two paths.
 *
 * The budget is checked here as well as inside `reviewHolding` so an
 * over-budget trader gets a 429 rather than a 200 carrying a "skipped".
 */
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const budget = await checkBudget();
  if (!budget.ok) {
    const status = budget.window === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: budget.message }, { status });
  }

  // The user's own client: RLS is what makes `id` safe to take from the URL.
  const supabase = await createClient();
  const outcome = await reviewHolding({
    supabase,
    userId: user.id,
    positionId: id,
    force: true,
  });

  if (outcome.status === "failed") {
    return NextResponse.json({ error: outcome.error }, { status: 500 });
  }
  if (outcome.status === "skipped") {
    return NextResponse.json({ error: outcome.reason }, { status: 429 });
  }

  const { data: review } = await supabase
    .from("holding_reviews")
    .select("*")
    .eq("position_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ review }, { status: 201 });
}
