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
    // Decode the base64url signature to raw bytes and flip every bit of the
    // first byte via XOR, then re-encode. Unlike swapping a single base64url
    // character (which can be a no-op when that character sits in the
    // trailing partial group and the flip happens to land on bits that don't
    // change the decoded value), XOR-ing a full decoded byte is guaranteed to
    // change the signature's actual bytes every time, regardless of what the
    // real signature happens to be — so this can't flake.
    const signatureBytes = Buffer.from(parts[2], "base64url");
    signatureBytes[0] = signatureBytes[0] ^ 0xff;
    parts[2] = signatureBytes.toString("base64url");
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
