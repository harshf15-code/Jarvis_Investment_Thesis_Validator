import { NextResponse } from "next/server";

import { readCockpit } from "@/lib/cockpit";
import { requirePortfolioScope } from "@/lib/portfolio/active";
import { createClient } from "@/lib/supabase/server";

/**
 * Screen HUB-1's aggregated read, for the BROWSER.
 *
 * The page itself no longer comes through here — it calls `readCockpit`
 * directly on the server and renders the numbers into the HTML, for the reason
 * `lib/queries.ts` gives: a Server Component is already on the server and has
 * no business making an HTTP request to its own app. This route exists for the
 * re-read, which has no server render to ride along with: renaming a book or
 * marking it as someone else's money changes this response without changing
 * which book is on screen.
 *
 * Scoped to one book since 0027, or to `?portfolio=all` for the roll-up. There
 * is no unscoped form: a request that does not say which book is a 400 rather
 * than a guess, because the wrong guess here shows one person's money as
 * another's.
 */
export async function GET(request: Request) {
  const scope = requirePortfolioScope(request);
  if (scope instanceof Response) return scope;

  const supabase = await createClient();

  try {
    const cockpit = await readCockpit(supabase, scope);
    if (!cockpit) {
      // The same answer RLS gives for someone else's row, and for the same
      // reason: refusing differently would confirm the id exists.
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }
    return NextResponse.json(cockpit);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the cockpit." },
      { status: 500 },
    );
  }
}

export type { CurrencyTotal } from "@/lib/cockpit";
