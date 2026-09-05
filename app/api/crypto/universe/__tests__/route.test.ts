import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/crypto-data", () => ({ fetchTopCoins: vi.fn() }));

import { fetchTopCoins } from "@/lib/crypto-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

let upserted: Record<string, unknown>[] | null = null;

function mockAdmin(error: { message: string } | null = null) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== "crypto_universe") throw new Error(`unexpected table ${table}`);
      return {
        upsert: async (rows: Record<string, unknown>[]) => {
          upserted = rows;
          return { error };
        },
      };
    }),
  };
}

const post = (secret = "s3cret") =>
  new Request("http://test/api/crypto/universe", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

beforeEach(() => {
  vi.clearAllMocks();
  upserted = null;
  vi.stubEnv("HOLDING_WATCH_SECRET", "s3cret");
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin() as never);
  vi.mocked(fetchTopCoins).mockResolvedValue([
    { coingecko_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
  ] as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/crypto/universe", () => {
  it("stores the ranked top ten", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect((await res.json()).refreshed).toBe(1);
    expect(upserted).toEqual([
      expect.objectContaining({ coingecko_id: "bitcoin", symbol: "BTC", market_cap_rank: 1 }),
    ]);
  });

  it("stamps refreshed_at so staleness is visible", async () => {
    await POST(post());
    expect(upserted![0].refreshed_at).toEqual(expect.any(String));
  });

  it("refuses a request with the wrong secret", async () => {
    const res = await POST(post("wrong-but-same-len"));
    expect(res.status).toBe(401);
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it("refuses every request while the secret is unset, rather than failing open", async () => {
    // An unauthenticated route that spends someone else's API quota is not
    // something to fail open on. Same rule as the holding watch.
    vi.stubEnv("HOLDING_WATCH_SECRET", "");
    expect((await POST(post())).status).toBe(401);
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it("502s when CoinGecko is unreachable, distinguishing it from our own failure", async () => {
    vi.mocked(fetchTopCoins).mockRejectedValue(new Error("boom"));
    expect((await POST(post())).status).toBe(502);
  });

  it("500s when the write fails, so a silent no-op cannot look like a refresh", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin({ message: "boom" }) as never);
    expect((await POST(post())).status).toBe(500);
  });
});
