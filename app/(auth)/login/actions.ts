"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createSessionToken } from "@/lib/auth/session";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches the JWT `exp`.
const LOGIN_PATH = "/login";

// Generic on purpose: never reveals *why* login failed (wrong password,
// missing/misconfigured APP_PASSWORD, empty submission, etc.) — same message
// for every failure mode.
const GENERIC_ERROR = "Incorrect password.";

export type LoginState = {
  error?: string;
};

/**
 * Constant-time string comparison. `timingSafeEqual` throws on a buffer
 * length mismatch, so unequal-length inputs are never passed to it directly
 * — that would both throw and (if merely caught) leak the length via
 * whichever code path executes. Instead, on a length mismatch, a same-length
 * dummy comparison is performed so the function takes comparable time on
 * both the "lengths differ" and "lengths match but content differs" paths,
 * and the real credential is never compared against attacker input in that
 * branch.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

export async function login(formData: FormData): Promise<LoginState> {
  const submitted = formData.get("password");
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    // The user-facing message stays deliberately generic (see GENERIC_ERROR),
    // but the operator needs to be able to tell "wrong password" apart from
    // "this deployment has no password configured" — otherwise a missing env
    // var on a fresh deploy is indistinguishable from a typo, and the correct
    // password appears to be rejected. This line goes to the server log only.
    console.error(
      "[config] APP_PASSWORD is not set, so every login attempt will be rejected. " +
        "Set it in your hosting provider's environment variables — .env.local is " +
        "never uploaded.",
    );
    return { error: GENERIC_ERROR };
  }

  if (typeof submitted !== "string") {
    return { error: GENERIC_ERROR };
  }

  if (!process.env.SESSION_SECRET) {
    console.error(
      "[config] SESSION_SECRET is not set. Even a correct password cannot mint " +
        "a session cookie. Generate one with `openssl rand -base64 32`.",
    );
    return { error: GENERIC_ERROR };
  }

  const matches = constantTimeEqual(submitted, appPassword);
  if (!matches) {
    return { error: GENERIC_ERROR };
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect("/");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect(LOGIN_PATH);
}
