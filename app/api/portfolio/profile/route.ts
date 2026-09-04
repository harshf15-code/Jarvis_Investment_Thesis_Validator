import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/user";
import { parsePortfolioParam, portfolioParamResponse } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";

/**
 * The trader's stated goal for ONE book.
 *
 * Keyed on the portfolio since 0027, not on the person. That is the mechanism
 * behind per-book advice: the portfolio Council and the Scratchpad pattern read
 * both measure a book against this sentence, so a retirement book run for
 * someone else and a personal high-conviction book are judged against the goals
 * they are actually being run toward.
 *
 * It is collected during the CSV import because that is the one moment a trader
 * is already thinking about a portfolio as a portfolio; asking later means
 * never.
 *
 * Both verbs take one book and never the roll-up. There is no such thing as the
 * objective of several books at once.
 */

const ProfileSchema = z.object({
  objective: z.string().trim().max(2000).nullable(),
});

/** One book, never the roll-up — see the note above. */
function oneBook(request: Request): string | null {
  const scope = parsePortfolioParam(new URL(request.url).searchParams.get("portfolio"));
  return scope?.mode === "one" ? scope.id : null;
}

export async function GET(request: Request) {
  const portfolioId = oneBook(request);
  if (!portfolioId) return portfolioParamResponse();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_profiles")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // `null` means "never asked FOR THIS BOOK", which is what the import flow
  // branches on — so a second portfolio is asked its own objective rather than
  // inheriting an answer given about the first.
  return NextResponse.json({ profile: data ?? null });
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const portfolioId = oneBook(request);
  if (!portfolioId) return portfolioParamResponse();

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
    // `onConflict` has to be named now. Until 0027 this worked without one
    // because `user_id` was both the primary key and its own default, so there
    // was exactly one row it could ever land on. The key is the book now, and
    // the book is supplied rather than defaulted.
    .upsert(
      {
        portfolio_id: portfolioId,
        objective: parsed.data.objective,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "portfolio_id" },
    )
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}
