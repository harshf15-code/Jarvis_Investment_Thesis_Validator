import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * What this app actually needs to know about the signed-in person.
 *
 * Narrower than Supabase's `User` on purpose. Ten call sites read `id` and one
 * reads `email`; nothing reads anything else. Returning the full object would
 * imply the rest of it is available and current, and after the change below it
 * is neither — these two fields come out of the verified token, and a token is
 * a snapshot of the moment it was issued, not a live row.
 */
export type SessionUser = { id: string; email: string | null };

/**
 * The signed-in user, or a redirect to /login.
 *
 * `proxy.ts` already gates these routes, so this is defence in depth rather
 * than the primary check — Next's own proxy documentation warns that a matcher
 * change or a moved route can silently drop proxy coverage, and asks that
 * authentication be verified where data is actually read. Row-level security
 * means a missed check leaks nothing; this exists so the failure mode is a
 * clean redirect rather than a screen of empty tables.
 *
 * Uses `getClaims()`, which VERIFIES the token's signature against the
 * project's published keys, rather than `getSession()`, which trusts the
 * cookie as-is. A cookie is attacker-controlled; the distinction is the whole
 * point, and it is the same rule `lib/supabase/proxy.ts` states.
 *
 * It used to use `getUser()`, which proves the same thing by ASKING the auth
 * server — an HTTPS round trip on every render of every page, measured at
 * 539ms average against this project (Supabase `edge_logs`, `/auth/v1/user`).
 * This project signs with ES256, so `getClaims()` verifies locally against a
 * cached key set and costs nothing.
 *
 * The cache is what makes that true, and it is worth knowing where it lives:
 * auth-js keeps the key set in a MODULE-scoped `GLOBAL_JWKS` with a ten-minute
 * TTL, not on the client instance. `lib/supabase/server.ts` builds a new client
 * per request on purpose — a shared one would leak sessions between concurrent
 * requests under Fluid Compute — and this is why that costs nothing here: the
 * per-request clients still share one key set, so the JWKS is fetched once per
 * process per ten minutes rather than once per page.
 *
 * Note the one case where the whole argument stops holding: a project signing
 * with a SYMMETRIC secret has no public key to verify against, and
 * `getClaims()` quietly falls back to the same server round trip `getUser()`
 * made. The security property holds either way; only the speed depends on the
 * key type. If this ever feels slow again, check the project's JWT signing keys
 * before rewriting anything here.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * The signed-in user, or null.
 *
 * `requireUser` redirects, which is right for a page and wrong for a route
 * handler — an API caller should get a 401, not an HTML redirect it will try to
 * parse as JSON. Route handlers that need the user's id (spend accounting) use
 * this instead.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // `sub` is the user id and is required in every Supabase access token, but
  // the type permits any payload shape (a Custom Access Token Hook can rewrite
  // it), so this refuses a token it cannot identify rather than handing back a
  // user whose id is `undefined` — which would read as signed-in everywhere.
  if (typeof claims?.sub !== "string" || claims.sub === "") return null;

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}
