import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Paths reachable without a session. Everything else redirects to /login. */
const PUBLIC_PATHS = ["/login", "/signup"];

/**
 * Refreshes the Supabase session cookie and gates every request on it.
 *
 * Two rules from Supabase's own guidance are load-bearing here:
 *
 *  - Use `getClaims()`, never `getSession()`. `getSession()` reads the cookie
 *    without revalidating it, and a cookie is attacker-controlled; `getClaims()`
 *    verifies the JWT signature against the project's published keys.
 *  - Do not put logic between `createServerClient` and `getClaims()`, and do
 *    not remove the `getClaims()` call. It is what writes refreshed tokens back
 *    onto the response — drop it and users get logged out at random.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Per-request, never hoisted to module scope: under Fluid Compute one
  // process serves concurrent requests, and a shared client would leak
  // sessions between them.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Must be the response the Supabase client wrote its cookies onto — building
  // a fresh NextResponse here would discard the refreshed session.
  return supabaseResponse;
}
