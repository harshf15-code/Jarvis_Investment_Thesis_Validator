import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/**
 * Service-role Supabase client. It authenticates as `service_role`, which
 * **bypasses row-level security entirely** — so it can read and write every
 * user's rows.
 *
 * Almost nothing should use it. Since `0013_user_accounts.sql` the app is
 * multi-user and isolation is enforced by RLS policies keyed on
 * `auth.uid()`; reaching for this client silently switches that enforcement
 * off. Anything serving a request should use `createClient()` from
 * `lib/supabase/server.ts` instead, which carries the caller's session.
 *
 * This is reserved for code that genuinely has no user to act as — scheduled
 * jobs and migrations. The Supabase Edge Functions have their own copy in
 * `supabase/functions/_shared/supabase-client.ts` (Deno cannot import from
 * here); they are the real users of this pattern.
 *
 * Never import this from client components — `SUPABASE_SERVICE_ROLE_KEY` is a
 * server-only secret (no `NEXT_PUBLIC_` prefix) and this module throws at call
 * time if it is missing, rather than silently running unauthenticated.
 */

let cachedClient: SupabaseClient<Database> | undefined;

export function createAdminClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is not set");
  }

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}
