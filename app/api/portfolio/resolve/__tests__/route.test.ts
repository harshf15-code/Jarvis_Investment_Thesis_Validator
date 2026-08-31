import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
  resolveYahooSymbol: (ticker: string, exchange: string) =>
    exchange === "NSE" ? `${ticker}.NS` : exchange === "BSE" ? `${ticker}.BO` : ticker,
}));

import { currentUser } from "@/lib/auth/user";
import { getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

type Draft = { index: number; ticker: string; quantity: number | null; averagePrice: number | null; date: string | null };

const row = (over: Partial<Draft> = {}): Draft => ({
  index: 0,
  ticker: "INFY",
  quantity: 10,
  averagePrice: 1500,
  date: null,
  ...over,
});

/** `held` are the tickers the caller already has an open position in. */
function buildSupabaseMock(held: string[] = []) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: held.map((ticker) => ({ ticker })), error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function post(body: Record<string, unknown>) {
  return new Request("http://test/api/portfolio/resolve", {
    method: "POST",
    body: JSON.stringify({ market: "IN", ...body }),
  }) as never;
}

/** Quotes for exactly the symbols listed; everything else throws, as Yahoo does. */
function quotesFor(symbols: Record<string, string>) {
  vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
    if (symbol in symbols) {
      return { price: 1600, asOf: new Date("2026-08-31T10:00:00Z"), name: symbols[symbol] };
    }
    throw new Error("not found");
  });
}

describe("POST /api/portfolio/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock() as never);
    quotesFor({ "INFY.NS": "Infosys Limited" });
  });

  it("401s a request with no session", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await POST(post({ rows: [row()] }));
    expect(res.status).toBe(401);
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("resolves a holding on the first exchange that quotes", async () => {
    const res = await POST(post({ rows: [row()] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows[0]).toMatchObject({
      status: "resolved",
      exchange: "NSE",
      yahooSymbol: "INFY.NS",
      companyName: "Infosys Limited",
      lastPrice: 1600,
    });
  });

  it("falls back to BSE when the NSE symbol does not quote", async () => {
    quotesFor({ "500325.BO": "Reliance Industries" });
    const res = await POST(post({ rows: [row({ ticker: "500325" })] }));
    const body = await res.json();
    expect(body.rows[0]).toMatchObject({ status: "resolved", exchange: "BSE" });
  });

  it("flags an unresolvable ticker with a reason instead of dropping it", async () => {
    // The acceptance criterion this feature turns on: a row that fails is
    // visible with a reason, never silently skipped.
    const res = await POST(post({ rows: [row({ ticker: "NOTAREALTICKER" })] }));
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].status).toBe("unresolved");
    expect(body.rows[0].reason).toMatch(/No listing found/);
  });

  it("rejects a zero cost basis without spending a quote on it", async () => {
    // `entries` carries check (price > 0). Catching it here is what stops it
    // surfacing as a failed insert after the trader confirms.
    const res = await POST(post({ rows: [row({ averagePrice: 0 })] }));
    const body = await res.json();
    expect(body.rows[0].status).toBe("invalid");
    expect(body.rows[0].reason).toMatch(/greater than zero/);
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("flags a ticker the trader already holds", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock(["INFY"]) as never);
    const res = await POST(post({ rows: [row()] }));
    const body = await res.json();
    expect(body.rows[0].status).toBe("duplicate");
    expect(body.rows[0].reason).toMatch(/already hold/);
    // Still priced, so the trader can see which company before confirming.
    expect(body.rows[0].companyName).toBe("Infosys Limited");
  });

  it("flags only the second appearance of a ticker repeated in one file", async () => {
    const res = await POST(post({ rows: [row({ index: 0 }), row({ index: 1 })] }));
    const body = await res.json();
    expect(body.rows[0].status).toBe("resolved");
    expect(body.rows[1].status).toBe("duplicate");
    expect(body.rows[1].reason).toMatch(/more than once/);
  });

  it("prefers the actionable reason when a row is both unpriceable and a repeat", async () => {
    const rows = [row({ index: 0, ticker: "GHOST" }), row({ index: 1, ticker: "GHOST" })];
    const res = await POST(post({ rows }));
    const body = await res.json();
    expect(body.rows[1].status).toBe("unresolved");
  });

  it("flags a repeat the client saw in another chunk of the same file", async () => {
    // The preview is chunked, so a ticker at row 3 and row 40 lands in two
    // different requests. Without the client's whole-file view the trader is
    // shown two clean rows and the second is silently skipped at commit,
    // having never been offered the checkbox.
    const res = await POST(post({ rows: [row({ index: 40 })], repeatedIndices: [40] }));
    const body = await res.json();
    expect(body.rows[0].status).toBe("duplicate");
    expect(body.rows[0].reason).toMatch(/more than once/);
  });

  it("refuses a row whose date is not a real calendar day", async () => {
    expect((await POST(post({ rows: [row({ date: "2026-02-31" })] }))).status).toBe(400);
  });

  it("refuses a chunk larger than the resolve limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => row({ index: i, ticker: `T${i}` }));
    expect((await POST(post({ rows }))).status).toBe(400);
  });

  it("refuses a market that is not live yet", async () => {
    const res = await POST(post({ market: "CN", rows: [row()] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not available yet/);
  });

  it("500s rather than silently disarming duplicate detection", async () => {
    // A failed positions lookup would otherwise mean "nothing is a duplicate",
    // which is the wrong default for a re-upload.
    vi.mocked(createClient).mockResolvedValue({
      from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }),
    } as never);
    expect((await POST(post({ rows: [row()] }))).status).toBe(500);
  });
});
