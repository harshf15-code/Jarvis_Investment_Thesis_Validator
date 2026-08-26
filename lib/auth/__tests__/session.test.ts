import { beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";

import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

const TEST_SECRET = "test-session-secret-value-not-used-in-prod";

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

describe("verifySessionToken", () => {
  it("accepts a token freshly issued by createSessionToken", async () => {
    const token = await createSessionToken();
    await expect(verifySessionToken(token)).resolves.toBe(true);
  });

  it("rejects a tampered token (signature no longer matches)", async () => {
    const token = await createSessionToken();
    const parts = token.split(".");
    // Flip the last character of the signature segment so the signature no
    // longer verifies against the payload/header.
    const lastChar = parts[2].slice(-1);
    const flipped = lastChar === "A" ? "B" : "A";
    parts[2] = parts[2].slice(0, -1) + flipped;
    const tampered = parts.join(".");

    await expect(verifySessionToken(tampered)).resolves.toBe(false);
  });

  it("rejects an expired token", async () => {
    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ authed: true })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(nowSeconds - 60)
      .setExpirationTime(nowSeconds - 10) // 10s in the past
      .sign(secretKey);

    await expect(verifySessionToken(expired)).resolves.toBe(false);
  });

  it("rejects a malformed token", async () => {
    await expect(verifySessionToken("not-a-jwt")).resolves.toBe(false);
  });

  it("rejects an empty/missing token", async () => {
    await expect(verifySessionToken("")).resolves.toBe(false);
  });

  it("fails closed when SESSION_SECRET is missing at verify time", async () => {
    const token = await createSessionToken();
    delete process.env.SESSION_SECRET;
    await expect(verifySessionToken(token)).resolves.toBe(false);
  });
});
