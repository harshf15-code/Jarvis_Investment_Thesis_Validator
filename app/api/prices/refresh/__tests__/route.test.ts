import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildAdminClientMock(stocks: { id: string; yahoo_symbol: string }[]) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: stocks, error: null }),
      }),
      update,
    }),
  };
}

describe("POST /api/prices/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-array stockIds body", async () => {
    const req = new Request("http://test/api/prices/refresh", {
      method: "POST",
      body: JSON.stringify({ stockIds: "not-an-array" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns fresh prices for each resolvable stock and omits failures", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminClientMock([
        { id: "s1", yahoo_symbol: "AAPL" },
        { id: "s2", yahoo_symbol: "BROKEN" },
      ]) as never,
    );
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "BROKEN") throw new Error("no quote");
      return { price: 150.25, asOf: new Date("2026-08-27T10:00:00Z") };
    });

    const req = new Request("http://test/api/prices/refresh", {
      method: "POST",
      body: JSON.stringify({ stockIds: ["s1", "s2"] }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.prices.s1.price).toBe(150.25);
    expect(body.prices.s1.asOf).toBe("2026-08-27T10:00:00.000Z");
    expect(body.prices.s2).toBeUndefined();
  });
});
