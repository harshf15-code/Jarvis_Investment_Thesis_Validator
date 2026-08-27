// Deno Edge Function module — NOT part of the Next.js build. Runs under
// Supabase's Deno runtime, imported via URL specifiers, not npm/Node
// module resolution.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

/**
 * Service-role Supabase client for Deno Edge Functions.
 *
 * Deliberately NOT a copy of `lib/supabase/admin.ts` in spirit beyond the
 * "service-role client" idea: that file reads `process.env` (Node) and
 * imports the hand-written `Database` type from `/lib`, neither of which
 * exists in this Deno deployable. `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` are read from `Deno.env` — both are injected
 * automatically into every Supabase Edge Function's runtime environment (no
 * manual `supabase secrets set` needed for these two), unlike
 * `AGENTMAIL_API_KEY`/`DIGEST_RECIPIENT_EMAIL` (see `daily-digest/`), which
 * are user secrets and must be set explicitly.
 *
 * Untyped (no `Database` generic): Deno can't import the Next.js `Database`
 * type from `/lib`, and hand-duplicating it here would be one more copy to
 * keep in sync with `supabase/migrations/`. Callers get `any`-shaped
 * `.from(...)` query builders and are expected to select only the columns
 * they need and validate shapes defensively, same as any other
 * untyped-client Postgres client.
 */
export function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) {
    throw new Error("SUPABASE_URL environment variable is not set");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY environment variable is not set",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
