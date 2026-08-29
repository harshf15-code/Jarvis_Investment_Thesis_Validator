import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Replaces the old `middleware.ts`. Next 16 deprecated the `middleware` file
 * convention in favour of `proxy` (the build warned about it), and Supabase's
 * Next.js integration is written against `proxy` too.
 *
 * The gate itself moved from a shared-password cookie to a Supabase session;
 * see `lib/supabase/proxy.ts`.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Excludes Next.js internal static/image asset paths and favicon.ico so auth
  // never blocks CSS/JS/images. Note `/api` is deliberately NOT excluded —
  // route handlers are gated by the same session check as pages.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
