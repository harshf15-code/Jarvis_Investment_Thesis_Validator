import { cookies } from "next/headers";

/**
 * Fetches this app's own API routes from inside a Server Component,
 * forwarding the incoming request's session cookie. A plain `fetch()` from
 * a server component does NOT automatically carry the original browser
 * request's cookies (it's a fresh outgoing request from the Next.js server
 * process) — and every route is gated by `middleware.ts` on the `session`
 * cookie, so an unforwarded self-fetch gets redirected to `/login` and
 * `res.json()` throws. Every server-component page that calls its own API
 * route must use this helper instead of a raw `fetch(...)`.
 *
 * Only callable from a Server Component (or Route Handler) — `cookies()`
 * from `next/headers` requires that context.
 */
export async function fetchInternalApi(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cookieStore = await cookies();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      cookie: cookieStore.toString(),
    },
    cache: init?.cache ?? "no-store",
  });
}
