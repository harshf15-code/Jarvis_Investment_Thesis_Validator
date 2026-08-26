import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifySessionToken } from "@/lib/auth/session";

const LOGIN_PATH = "/login";
const SESSION_COOKIE = "session";

// Single shared-password gate (Task 2). Every request matched by `config.matcher`
// below is checked for a valid `session` cookie:
// - Unauthenticated + not already on /login -> redirect to /login.
// - Authenticated + on /login -> redirect to / (no reason to show the form again).
// - Otherwise -> let the request through unmodified.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isAuthed = token ? await verifySessionToken(token) : false;

  if (pathname === LOGIN_PATH) {
    if (isAuthed) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthed) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Excludes Next.js internal static/image asset paths and favicon.ico so
  // auth logic never blocks CSS/JS/images from loading. All real app routes
  // (including /login) fall through to the middleware function above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
