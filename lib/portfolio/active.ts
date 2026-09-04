import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PORTFOLIO_PARAM_ERROR,
  parsePortfolioParam,
  type PortfolioScope,
} from "@/lib/portfolio/scope";
import { createClient } from "@/lib/supabase/server";
import type { Database, Portfolio } from "@/lib/types";

/**
 * The SERVER half of portfolio scoping: the pieces that touch a request or the
 * database. The pure parser and the constants live in `lib/portfolio/scope.ts`,
 * which client components import — this module reaches `next/headers` through
 * `lib/supabase/server.ts` and cannot be bundled for the browser.
 *
 * Re-exported here so a route can keep importing one module.
 */
export * from "@/lib/portfolio/scope";

type Client = SupabaseClient<Database>;

/** The shared 400, so every route's refusal reads identically. */
export function portfolioParamResponse(): NextResponse {
  return NextResponse.json({ error: PORTFOLIO_PARAM_ERROR }, { status: 400 });
}

/**
 * Parses straight from a request, or hands back the 400 to return.
 *
 * The union is deliberate: a caller cannot forget to handle the failure,
 * because the success shape is not a `Response`.
 */
export function requirePortfolioScope(request: Request): PortfolioScope | NextResponse {
  const scope = parsePortfolioParam(new URL(request.url).searchParams.get("portfolio"));
  return scope ?? portfolioParamResponse();
}

/**
 * Refuses a scope naming a book this trader cannot see, or `null` to carry on.
 *
 * Parsing proves a string is uuid-SHAPED. It does not prove the book exists,
 * and RLS hides someone else's row rather than erroring on it — so without this
 * a deleted or foreign id reads as a book that is simply empty. Every history
 * endpoint would answer 200 with `[]`, and the import preview would answer "no
 * duplicates found", which is not an empty answer but a wrong one: the check
 * that exists to stop a re-upload silently reports nothing to stop.
 *
 * 404 rather than 403, matching the write paths and RLS itself — refusing
 * differently would confirm that the id exists.
 */
export async function requireVisibleBook(
  supabase: Client,
  portfolioId: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  return null;
}

/**
 * `requirePortfolioScope` plus the existence check — what a scoped READ wants.
 *
 * The roll-up needs no check: it names no book, and RLS already bounds it to
 * this trader's own.
 */
export async function requireScopedRead(
  request: Request,
  supabase: Client,
): Promise<PortfolioScope | NextResponse> {
  const scope = requirePortfolioScope(request);
  if (scope instanceof NextResponse) return scope;
  if (scope.mode === "one") {
    const refusal = await requireVisibleBook(supabase, scope.id);
    if (refusal) return refusal;
  }
  return scope;
}

/**
 * This trader's books, default first.
 *
 * RLS scopes it. Every scoped route loads this once and resolves the scope
 * against it, which is what turns "a uuid in a query string" into "a book this
 * person actually owns" without a second round trip.
 */
export async function listPortfolios(supabase: Client): Promise<Portfolio[]> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The name every account's first book gets, in the migration and here. */
export const DEFAULT_PORTFOLIO_NAME = "My Portfolio";

/**
 * This trader's books, creating the default when there are none.
 *
 * The one write a read path performs, and it earns the exception: this app has
 * no `after insert on auth.users` trigger — the one it had was dropped in 0015
 * — so without this a new account would have somewhere to look and nowhere to
 * put anything. Doing it in application code rather than a trigger also keeps
 * it inside the test suite, where a trigger on the `auth` schema is invisible.
 *
 * Idempotent by construction: `idx_portfolios_one_default` permits exactly one
 * `is_default` row per trader, so two concurrent first requests cannot make two
 * books — the loser's insert fails and it re-reads.
 */
export async function listPortfoliosEnsuringDefault(supabase: Client): Promise<Portfolio[]> {
  const existing = await listPortfolios(supabase);
  if (existing.length > 0) return existing;

  await supabase
    .from("portfolios")
    .insert({ name: DEFAULT_PORTFOLIO_NAME, ownership: "owned", is_default: true });

  // Re-read either way. On the happy path it returns the row just written; on a
  // lost race it returns the winner's, which is both the fix and the proof.
  return listPortfolios(supabase);
}

/**
 * The scope for a SERVER-RENDERED page, which cannot read `localStorage`.
 *
 * A page reached without a book in its URL redirects to the default rather than
 * rendering one implicitly, so the address bar always says which book is on
 * screen. That is what keeps the choice explicit: the URL is the carrier, and
 * nothing infers a book from ambient state.
 *
 * The redirect is not the "silent default" the PRD forbids — that rule is about
 * WRITES, where a position must never be filed without someone choosing a book.
 * A reader arriving at /positions with no opinion has to land somewhere, and
 * landing somewhere named is better than landing on everything at once.
 */
export async function pageScope(
  pathname: string,
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<{ scope: PortfolioScope; portfolios: Portfolio[]; active: Portfolio | null }> {
  const supabase = await createClient();
  const portfolios = await listPortfoliosEnsuringDefault(supabase);

  const raw = (await searchParams).portfolio;
  const scope = parsePortfolioParam(typeof raw === "string" ? raw : null);

  if (!scope || (scope.mode === "one" && !portfolios.some((p) => p.id === scope.id))) {
    const fallback = portfolios.find((p) => p.is_default) ?? portfolios[0];
    // No fallback means the insert above failed for a real reason. Throwing
    // reaches the nearest error.tsx, which is the right place for "the page
    // cannot read its own list" — the same contract as `lib/queries.ts`.
    if (!fallback) throw new Error("Could not read your portfolios.");
    redirect(`${pathname}?portfolio=${fallback.id}`);
  }

  return {
    scope,
    portfolios,
    active: scope.mode === "one" ? (portfolios.find((p) => p.id === scope.id) ?? null) : null,
  };
}
