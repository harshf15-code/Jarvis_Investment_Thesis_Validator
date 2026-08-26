import { SignJWT, jwtVerify } from "jose";

/**
 * Single shared-password session token. No user accounts — the JWT payload
 * only ever asserts `{ authed: true }`; there is no subject/identity to leak.
 *
 * `SESSION_SECRET` must be set in the environment. `createSessionToken` is
 * only ever called after a successful password check (see
 * `app/(auth)/login/actions.ts`), so a missing secret there is a genuine
 * server misconfiguration and is allowed to throw. `verifySessionToken` is
 * called on every gated request, including with attacker-controlled cookie
 * values, so it fails closed (returns `false`) on *any* error — bad
 * signature, expired token, malformed token, or a missing/misconfigured
 * secret — rather than throwing into the caller (middleware).
 */

const SESSION_DURATION = "30d";
const ALG = "HS256";

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ authed: true })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  if (!token) {
    return false;
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: [ALG],
    });
    return payload.authed === true;
  } catch {
    // Any verification failure — bad signature (JWSSignatureVerificationFailed),
    // expired (JWTExpired), malformed token (JWTInvalid / JWSInvalid), or a
    // missing/misconfigured SESSION_SECRET — fails closed here rather than
    // throwing into the caller (middleware, on every gated request).
    return false;
  }
}
