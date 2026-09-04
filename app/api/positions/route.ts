import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listOpenPositions } from "@/lib/queries";
import { requirePortfolioScope } from "@/lib/portfolio/active";
import { z } from "zod";

export async function GET(request: Request) {
  const scope = requirePortfolioScope(request);
  if (scope instanceof Response) return scope;

  try {
    return NextResponse.json({ positions: await listOpenPositions(scope) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

const CreatePositionSchema = z.object({
  /**
   * Which book this is bought in. Required, with no server-side default, even
   * for a trader who has only one — the UI asks every time.
   *
   * A share filed against the wrong person's money is not a cosmetic mistake,
   * and the moment where it would happen is exactly this one: a busy trader
   * converting a recommendation without reading the form. Silence would be the
   * cheap option here and it is the one that gets someone's mother's retirement
   * counted as the trader's own.
   */
  portfolio_id: z.string().uuid("Choose which portfolio this position belongs to."),
  trade_plan_id: z.string().min(1),
  thesis_id: z.string().min(1),
  stock_id: z.string().min(1),
  ticker: z.string().min(1),
  date: z.string().date(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  tranche: z.enum(["T1", "T2", "add"]),
  jarvis_recommendation_id: z.string().optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  if (json === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreatePositionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { jarvis_recommendation_id, date, quantity, price, tranche, ...positionFields } = parsed.data;

  const supabase = await createClient();

  // Named rather than left to the foreign key. 0027 would refuse a book that is
  // not this trader's anyway — the key is on (portfolio_id, user_id) — but it
  // would refuse it as a constraint violation, and "Portfolio not found" is the
  // answer a person can act on.
  const { data: book, error: bookError } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", positionFields.portfolio_id)
    .maybeSingle();
  if (bookError) {
    return NextResponse.json({ error: bookError.message }, { status: 500 });
  }
  if (!book) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert(positionFields)
    .select("*")
    .single();
  if (positionError || !position) {
    return NextResponse.json({ error: positionError?.message ?? "Failed to create position" }, { status: 500 });
  }

  const { error: entryError } = await supabase
    .from("entries")
    .insert({ position_id: position.id, date, quantity, price, tranche });
  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }

  if (jarvis_recommendation_id) {
    const { error: recError } = await supabase
      .from("jarvis_recommendations")
      .update({ converted_to_position: true, position_id: position.id })
      .eq("id", jarvis_recommendation_id);
    if (recError) {
      return NextResponse.json({ error: recError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ position }, { status: 201 });
}
