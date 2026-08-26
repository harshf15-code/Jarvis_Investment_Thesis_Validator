import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/**
 * Service-role Supabase client. This is the ONLY Supabase client used by
 * API routes/server code in this plan: RLS on every table is deny-all for
 * `anon` (this is a single-user app gated by the shared-password session,
 * not by Supabase auth — see the architecture plan's single-user
 * simplification), so a service-role key is required to read/write at all,
 * and there is no anon/browser read path in this plan for it to bypass.
 *
 * Never import this from client components — `SUPABASE_SERVICE_ROLE_KEY` is
 * a server-only secret (no `NEXT_PUBLIC_` prefix) and this module will throw
 * at call time if it's missing, rather than silently running unauthenticated.
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
