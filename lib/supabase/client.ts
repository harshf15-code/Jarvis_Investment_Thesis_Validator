import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/types";

/**
 * Browser Supabase client. Used only for auth calls made from client
 * components; all data still goes through this app's own API routes, which
 * query with the server client in `lib/supabase/server.ts`.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
  }
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set");
  }

  return createBrowserClient<Database>(url, anonKey);
}
