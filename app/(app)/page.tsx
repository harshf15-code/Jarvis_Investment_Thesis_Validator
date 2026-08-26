import Link from "next/link";

import { WatchlistGrid } from "@/components/dashboard/watchlist-grid";

/**
 * Forces this route to render per-request instead of being statically
 * prerendered at build time. Without this, Next.js treats `/` as
 * static-eligible (nothing here calls `cookies()`/`headers()`/etc.) and
 * tries to prerender it during `next build`, which calls
 * `WatchlistGrid` -> `createAdminClient()` at build time and throws on the
 * missing `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` env vars
 * (there's no live DB to build against — see the task brief's Verify
 * section). A live watchlist is exactly the kind of per-request data this
 * page should never freeze into a static build anyway.
 */
export const dynamic = "force-dynamic";

/**
 * The dashboard — the app's `/` route (inside the `(app)` route group, which
 * `middleware.ts`/Task 2 guarantees is never reached without a valid
 * session). Replaces Task 1's token-wiring placeholder.
 *
 * The logout control lives in `app/(app)/layout.tsx` (a fixed bottom-right
 * button, unaffected by this page); this top bar only adds the "Add Stock"
 * CTA the brief asks for.
 */
export default function AppHomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-on-surface">
          Watchlist
        </h1>
        <Link
          href="/add"
          className="inline-flex h-10 items-center rounded-xl bg-gradient-to-br from-primary to-primary-container px-4 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          Add Stock
        </Link>
      </header>

      <WatchlistGrid />
    </main>
  );
}
