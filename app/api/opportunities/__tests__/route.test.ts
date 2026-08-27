// app/api/opportunities/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { GET, POST } from "../route";

type Opportunity = {
  id: string;
  ticker: string;
  market: string;
  conviction_tier: string | null;
  watching_only: boolean;
};
type Stock = { ticker: string; exchange: string; last_price: number | null; last_price_at: string | null };
type Position = { ticker: string };
type Thesis = { ticker: string; status: string };

function buildMock(options?: {
  opportunities?: Opportunity[];
  stocks?: Stock[];
  positions?: Position[];
  theses?: Thesis[];
}) {
  const opportunities = options?.opportunities ?? [
    { id: "o1", ticker: "AAA", market: "NSE", conviction_tier: "I", watching_only: false },
  ];
  const stocks = options?.stocks ?? [];
  const positions = options?.positions ?? [];
  const theses = options?.theses ?? [];

  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "op1", ticker: "AAA" }, error: null }),
    }),
  });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "opportunities") {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: opportunities, error: null }),
          }),
          insert,
        };
      }
      if (table === "stocks") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: stocks, error: null }),
          }),
        };
      }
      if (table === "positions") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: positions, error: null }),
            }),
          }),
        };
      }
      if (table === "theses") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: theses, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _insert: insert,
  };
}

describe("GET /api/opportunities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves currentPrice/lastPriceAt for a ticker that matches a stock, and null for one that matches nothing", async () => {
    const mock = buildMock({
      opportunities: [
        { id: "o1", ticker: "AAA", market: "NSE", conviction_tier: "I", watching_only: false },
        { id: "o2", ticker: "ZZZ", market: "NSE", conviction_tier: "II", watching_only: false },
      ],
      stocks: [{ ticker: "AAA", exchange: "NSE", last_price: 100, last_price_at: "2026-08-20T10:00:00Z" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const res = await GET();
    const body = await res.json();
    const rowA = body.opportunities.find((r: { opportunity: { ticker: string } }) => r.opportunity.ticker === "AAA");
    const rowZ = body.opportunities.find((r: { opportunity: { ticker: string } }) => r.opportunity.ticker === "ZZZ");
    expect(rowA.currentPrice).toBe(100);
    expect(rowA.lastPriceAt).toBe("2026-08-20T10:00:00Z");
    expect(rowZ.currentPrice).toBeNull();
    expect(rowZ.lastPriceAt).toBeNull();
  });

  it("marks held true for a ticker with an active position and false otherwise", async () => {
    const mock = buildMock({
      opportunities: [
        { id: "o1", ticker: "AAA", market: "NSE", conviction_tier: "I", watching_only: false },
        { id: "o2", ticker: "BBB", market: "NSE", conviction_tier: "I", watching_only: false },
      ],
      positions: [{ ticker: "AAA" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const res = await GET();
    const body = await res.json();
    const rowA = body.opportunities.find((r: { opportunity: { ticker: string } }) => r.opportunity.ticker === "AAA");
    const rowB = body.opportunities.find((r: { opportunity: { ticker: string } }) => r.opportunity.ticker === "BBB");
    expect(rowA.held).toBe(true);
    expect(rowB.held).toBe(false);
  });

  it("marks draft true for a ticker with a draft thesis", async () => {
    const mock = buildMock({
      opportunities: [
        { id: "o1", ticker: "AAA", market: "NSE", conviction_tier: "I", watching_only: false },
        { id: "o2", ticker: "BBB", market: "NSE", conviction_tier: "I", watching_only: false },
      ],
      theses: [{ ticker: "AAA", status: "draft" }],
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const res = await GET();
    const body = await res.json();
    const rowA = body.opportunities.find((r: { opportunity: { ticker: string } }) => r.opportunity.ticker === "AAA");
    const rowB = body.opportunities.find((r: { opportunity: { ticker: string } }) => r.opportunity.ticker === "BBB");
    expect(rowA.draft).toBe(true);
    expect(rowB.draft).toBe(false);
  });
});

describe("POST /api/opportunities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a body with no ticker", async () => {
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ market: "NSE" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("creates an opportunity", async () => {
    const mock = buildMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ ticker: "AAA", market: "NSE", watching_only: true }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    expect(mock._insert).toHaveBeenCalled();
  });
});
