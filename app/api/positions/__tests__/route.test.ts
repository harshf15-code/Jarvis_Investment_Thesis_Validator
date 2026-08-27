import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildSupabaseMock() {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "pos-1", status: "active", ticker: "AAPL" },
                error: null,
              }),
            }),
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
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const req = new Request("http://test", {
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
        jarvis_recommendation_id: "rec1",
      }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.position.id).toBe("pos-1");
    expect(mock._updateEq).toHaveBeenCalledWith("id", "rec1");
  });
});
