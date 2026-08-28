import { cookies } from "next/headers";

/**
 * Base URL for a self-fetch, in order of preference:
 *
 * 1. `NEXT_PUBLIC_SITE_URL`, when explicitly configured.
 * 2. `VERCEL_URL`, which Vercel injects into every deployment automatically.
 *    Without this fallback a deployment that forgot to set the site URL would
 *    self-fetch `http://localhost:3000` — nothing listens on that port inside a
 *    serverless function, so every server-rendered page that reads data fails
 *    with an opaque connection error while login and the client-rendered pages
 *    keep working. That is a miserable thing to debug.
 * 3. localhost, for `next dev`.
 */
function resolveBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  // VERCEL_URL is a bare host with no protocol, and is always https.
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[config] Neither NEXT_PUBLIC_SITE_URL nor VERCEL_URL is set. " +
        "Server-rendered pages will try to fetch http://localhost:3000 and fail. " +
        "Set NEXT_PUBLIC_SITE_URL to this deployment's public URL.",
    );
  }
  return "http://localhost:3000";
}

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
  const baseUrl = resolveBaseUrl();

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      cookie: cookieStore.toString(),
    },
    cache: init?.cache ?? "no-store",
  });
}
