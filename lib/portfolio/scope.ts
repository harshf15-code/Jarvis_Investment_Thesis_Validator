import type { Portfolio } from "@/lib/types";

/**
 * Which book (or books) a request is about — the PURE half.
 *
 * Split from `lib/portfolio/active.ts` because the switcher and the provider
 * are client components and need these constants, while `active.ts` reaches for
 * `lib/supabase/server.ts` and therefore `next/headers`. Importing the server
 * client into a browser bundle is a build error, and the split is the honest
 * fix: nothing here touches a request, a cookie or a database.
 *
 * Every portfolio-scoped read takes an explicit `?portfolio=` — a uuid, or the
 * literal `all` for the roll-up — and **a request without one is a 400, not a
 * guess.** The reason is blunt: a mis-scoped read here shows one person's money
 * as another's, and an ambient default is exactly how that ships unnoticed. It
 * is the same instinct as 0027's composite foreign key, one layer up.
 */

export type PortfolioScope = { mode: "one"; id: string } | { mode: "all" };

/** The roll-up, spelled out. Not a uuid, so it can never collide with a real id. */
export const ALL_PORTFOLIOS = "all";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PORTFOLIO_PARAM_ERROR =
  "This request must say which portfolio it is about. Add ?portfolio=<id>, or ?portfolio=all for every book.";

export const PORTFOLIO_WRITE_SCOPE_ERROR =
  "Choose one portfolio. Something can be recorded in a book, but not in a roll-up of several.";

/**
 * `null` when the parameter is missing or malformed — the caller returns a 400.
 *
 * A valid uuid is LOWER-CASED on the way through. Postgres renders `uuid` in
 * lower case, and `resolveScope` matches on string equality, so an id that
 * arrived upper-cased — from a hand-typed URL, or anything that upper-cases
 * hex — would parse cleanly and then resolve to nothing, which the routes
 * report as a 404 on a book the trader owns.
 */
export function parsePortfolioParam(raw: string | null): PortfolioScope | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === ALL_PORTFOLIOS) return { mode: "all" };
  if (UUID.test(value)) return { mode: "one", id: value.toLowerCase() };
  return null;
}

/**
 * The books a scope names, or `null` when it names one this trader does not own.
 *
 * `null` is a 404 rather than a 403 — the same answer RLS gives for someone
 * else's row, and for the same reason: refusing differently would confirm that
 * the id exists.
 */
export function resolveScope(portfolios: Portfolio[], scope: PortfolioScope): Portfolio[] | null {
  if (scope.mode === "all") return portfolios;
  const found = portfolios.find((p) => p.id === scope.id);
  return found ? [found] : null;
}

/**
 * The one book a write is about, or `null` to refuse.
 *
 * Writes never accept `all`: a position is bought in a book, and a roll-up is a
 * view rather than a place. Kept beside the read parser so the two rules stay
 * visibly different on purpose.
 */
export function resolveWriteTarget(portfolios: Portfolio[], portfolioId: string): Portfolio | null {
  return portfolios.find((p) => p.id === portfolioId) ?? null;
}

/**
 * The subset whose money is the trader's own.
 *
 * The headline total on the cockpit sums these and nothing else. A managed book
 * is somebody else's capital, and folding it into a net-worth number makes that
 * number mean something other than what it says.
 */
export function ownedOnly(portfolios: Portfolio[]): Portfolio[] {
  return portfolios.filter((p) => p.ownership === "owned");
}
