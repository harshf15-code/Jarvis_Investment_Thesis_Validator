import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

/** Reads `stocks` — the user's own session client, since reads are allowed to it. */
function buildReadClientMock(stocks: { id: string; yahoo_symbol: string }[]) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: stocks, error: null }),
      }),
    }),
  };
}

/** Writes the refreshed price back. Separate client on purpose — see 0014. */
function buildWriteClientMock() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  return { client: { from: vi.fn().mockReturnValue({ update }) }, update, eq };
}

function postWith(stockIds: unknown) {
  return POST(
    new Request("http://test/api/prices/refresh", {
      method: "POST",
      body: JSON.stringify({ stockIds }),
    }) as never,
  );
}

describe("POST /api/prices/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-array stockIds body", async () => {
    expect((await postWith("not-an-array")).status).toBe(400);
  });

  it("rejects more ids than the per-request cap", async () => {
    // Each id costs an outbound Yahoo fetch (up to 3 attempts) plus a write, so
    // an uncapped list would let one request fan out to thousands of calls.
    const res = await postWith(Array.from({ length: 51 }, (_, i) => `s${i}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 50/i);
  });

  it("accepts a request exactly at the cap", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `s${i}`);
    vi.mocked(createClient).mockResolvedValue(buildReadClientMock([]) as never);
    vi.mocked(createAdminClient).mockReturnValue(buildWriteClientMock().client as never);
    expect((await postWith(ids)).status).toBe(200);
  });

  it("returns fresh prices for each resolvable stock and omits failures", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildReadClientMock([
        { id: "s1", yahoo_symbol: "AAPL" },
        { id: "s2", yahoo_symbol: "BROKEN" },
      ]) as never,
    );
    const writer = buildWriteClientMock();
    vi.mocked(createAdminClient).mockReturnValue(writer.client as never);
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "BROKEN") throw new Error("no quote");
      return { price: 150.25, asOf: new Date("2026-08-27T10:00:00Z") };
    });

    const res = await postWith(["s1", "s2"]);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.prices.s1.price).toBe(150.25);
    expect(body.prices.s1.asOf).toBe("2026-08-27T10:00:00.000Z");
    expect(body.prices.s2).toBeUndefined();

    // The price write-back must go through the service-role client: since 0014
    // `authenticated` may read `stocks` but not write it.
    expect(writer.update).toHaveBeenCalledTimes(1);
    expect(writer.update).toHaveBeenCalledWith({
      last_price: 150.25,
      last_price_at: "2026-08-27T10:00:00.000Z",
    });
  });
});
