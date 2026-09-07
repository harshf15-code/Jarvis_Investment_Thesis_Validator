import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted: `vi.mock` factories run before module-level `const`s are assigned.
const { getClaims, redirect } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { currentUser, requireUser } from "@/lib/auth/user";

/**
 * These two used to call `getUser()`, an HTTPS round trip to the auth server on
 * every render. They now read the VERIFIED token instead, which means the
 * mapping from claims to the app's `SessionUser` is real logic rather than a
 * pass-through — and one branch of it (a token with no usable `sub`) is the
 * difference between "not signed in" and a user whose id is `undefined`.
 */
describe("currentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps sub and email off the claims", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", email: "t@example.com", role: "authenticated" } },
    });
    expect(await currentUser()).toEqual({ id: "user-1", email: "t@example.com" });
  });

  it("reads a token with no email as signed in without one", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    expect(await currentUser()).toEqual({ id: "user-1", email: null });
  });

  it("is null when there is no token", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect(await currentUser()).toBeNull();
  });

  // A Custom Access Token Hook can rewrite the payload, and the claims type
  // permits any shape. Returning `{ id: undefined }` here would read as signed
  // in at all ten call sites.
  it("refuses a token whose sub is missing or not a string", async () => {
    getClaims.mockResolvedValue({ data: { claims: { email: "t@example.com" } } });
    expect(await currentUser()).toBeNull();

    getClaims.mockResolvedValue({ data: { claims: { sub: 42 } } });
    expect(await currentUser()).toBeNull();

    getClaims.mockResolvedValue({ data: { claims: { sub: "" } } });
    expect(await currentUser()).toBeNull();
  });

  // The distinction this pair pins: `getClaims` reports "the auth server
  // rejected your token" and "I could not reach the auth server" through the
  // same `error` field, and only the first one means signed out. Collapsing
  // them sends a signed-in trader to /login whenever the JWKS fetch fails.
  it("treats a rejected token as signed out", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("invalid JWT"), { status: 400, code: "invalid_jwt" }),
    });
    expect(await currentUser()).toBeNull();
  });

  it("throws when it could not reach the auth server", async () => {
    // AuthRetryableFetchError: status 0 when fetch itself failed, 5xx when the
    // gateway answered badly. Neither says anything about this token.
    getClaims.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Failed to fetch"), { status: 0 }),
    });
    await expect(currentUser()).rejects.toThrow("Failed to fetch");

    getClaims.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("HTTP 503"), { status: 503 }),
    });
    await expect(currentUser()).rejects.toThrow("HTTP 503");

    // AuthUnknownError carries no status at all.
    getClaims.mockResolvedValue({ data: null, error: new Error("something else") });
    await expect(currentUser()).rejects.toThrow("something else");
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the user when the token is good", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1", email: "t@example.com" } } });
    expect(await requireUser()).toEqual({ id: "user-1", email: "t@example.com" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is none", async () => {
    getClaims.mockResolvedValue({ data: null });
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("does not redirect when the verification itself failed", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Failed to fetch"), { status: 0 }),
    });
    await expect(requireUser()).rejects.toThrow("Failed to fetch");
    expect(redirect).not.toHaveBeenCalled();
  });
});
