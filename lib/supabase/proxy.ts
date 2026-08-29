import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Paths reachable without a session.
 *
 * `/` is the public landing page, so it is listed here but behaves differently
 * from the two auth pages: a signed-in visitor is bounced off /login and
 * /signup (there is nothing there for them) but may still read the landing
 * page, which offers them the cockpit instead of a sign-up button.
 */
const AUTH_PATHS = ["/login", "/signup"];
const PUBLIC_PATHS = ["/", ...AUTH_PATHS];

/** Where a signed-in user lands: the cockpit, not the marketing page. */
const HOME_PATH = "/dashboard";

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}

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

  if (!user && !matches(pathname, PUBLIC_PATHS)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && matches(pathname, AUTH_PATHS)) {
    const url = request.nextUrl.clone();
    url.pathname = HOME_PATH;
    return NextResponse.redirect(url);
  }

  // Must be the response the Supabase client wrote its cookies onto — building
  // a fresh NextResponse here would discard the refreshed session.
  return supabaseResponse;
}
