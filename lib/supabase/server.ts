import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/types";

/**
 * Request-scoped Supabase client carrying the signed-in user's session.
 *
 * This is the client almost everything should use. Because it authenticates
 * as the user rather than as `service_role`, Postgres applies the row-level
 * security policies from `0013_user_accounts.sql` to every query — which is
 * what keeps one account's theses, positions and journal out of another's.
 * Isolation is therefore a property of the database, not of whether each
 * call site remembered to filter. Contrast `lib/supabase/admin.ts`, which
 * bypasses RLS entirely and is now reserved for code with no user at all.
 *
 * A new client per request, never a module-level singleton: it closes over
 * this request's cookies, and Fluid Compute reuses the same process across
 * concurrent requests — a cached client would serve one user's session to
 * another.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
  }
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set");
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components may not set cookies. Safe to ignore: `proxy.ts`
          // refreshes the session on every request, so a token that could not
          // be written back here is rewritten there on the next one.
        }
      },
    },
  });
}
