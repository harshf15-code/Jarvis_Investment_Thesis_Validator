import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

/** The book the position is filed in. Uuid-shaped: the route validates it. */
const PF1 = "11111111-1111-4111-8111-111111111111";

function buildSupabaseMock({ bookExists = true } = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const inserted: Record<string, unknown>[] = [];
  return {
    _inserted: inserted,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "portfolios") {
        // The route names the book before writing, so a bad id is a 404 rather
        // than a foreign-key violation from the composite key in 0027.
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: bookExists ? { id: PF1 } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "positions") {
        return {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "pos-1", status: "active", ticker: "AAPL" },
                  error: null,
                }),
              }),
            };
          }),
        };
      }
      if (table === "entries") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "jarvis_recommendations") {
        return { update: vi.fn().mockReturnValue({ eq: updateEq }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _updateEq: updateEq,
  };
}

describe("POST /api/positions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a position + first entry and links a recommendation when provided", async () => {
    const mock = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({
        portfolio_id: PF1,
        trade_plan_id: "tp1",
        thesis_id: "th1",
        stock_id: "s1",
        ticker: "AAPL",
        date: "2026-08-27",
        quantity: 10,
        price: 150,
        tranche: "T1",
        jarvis_recommendation_id: "rec1",
      }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.position.id).toBe("pos-1");
    expect(mock._updateEq).toHaveBeenCalledWith("id", "rec1");
    expect(mock._inserted[0].portfolio_id).toBe(PF1);
  });

  /* --- portfolio scoping (0027) ---------------------------------------- */

  it("refuses a buy that does not say which portfolio it is in", async () => {
    const mock = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({
          trade_plan_id: "tp1",
          thesis_id: "th1",
          stock_id: "s1",
          ticker: "AAPL",
          date: "2026-08-27",
          quantity: 10,
          price: 150,
          tranche: "T1",
        }),
      }) as never,
    );

    // No default, even for a trader with one book. A share filed against the
    // wrong person's money is the failure this refusal exists to prevent.
    expect(res.status).toBe(400);
    expect(mock._inserted).toHaveLength(0);
  });

  it("404s rather than writing when the portfolio is not this trader's", async () => {
    const mock = buildSupabaseMock({ bookExists: false });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({
          portfolio_id: "99999999-9999-4999-8999-999999999999",
          trade_plan_id: "tp1",
          thesis_id: "th1",
          stock_id: "s1",
          ticker: "AAPL",
          date: "2026-08-27",
          quantity: 10,
          price: 150,
          tranche: "T1",
        }),
      }) as never,
    );

    expect(res.status).toBe(404);
    expect(mock._inserted).toHaveLength(0);
  });
});
