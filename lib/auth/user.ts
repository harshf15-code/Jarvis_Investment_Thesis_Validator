import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
 * Uses `getUser()`, which revalidates the token with the auth server, rather
 * than `getSession()`, which trusts the cookie as-is.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
