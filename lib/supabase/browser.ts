import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/**
 * Anon-key Supabase client for use in client components. Stubbed for
 * completeness: nothing in this plan currently reads/writes Supabase from
 * the browser (RLS is deny-all for `anon` — see `lib/supabase/admin.ts` —
 * and all data access goes through server-side API routes using the
 * service-role client instead), so this is intentionally minimal.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
  }
  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set",
    );
  }

  return createSupabaseClient<Database>(url, anonKey);
}
