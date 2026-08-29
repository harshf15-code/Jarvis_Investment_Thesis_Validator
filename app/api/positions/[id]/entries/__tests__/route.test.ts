import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

function buildSupabaseMock(existingEntries: { quantity: number; price: number }[]) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "e1", position_id: "p1", date: "2026-08-27", quantity: 50, price: 120, tranche: "add" },
            error: null,
          }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: existingEntries, error: null }),
      }),
    }),
  };
}

describe("POST /api/positions/[id]/entries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-positive quantity", async () => {
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 0, price: 100, tranche: "T1" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("inserts the entry and returns the recomputed weighted average", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildSupabaseMock([{ quantity: 100, price: 100 }, { quantity: 50, price: 120 }]) as never,
    );
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 50, price: 120, tranche: "add" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.weightedAverage.totalQuantity).toBe(150);
    expect(body.weightedAverage.averagePrice).toBeCloseTo(106.67, 1);
  });
});
