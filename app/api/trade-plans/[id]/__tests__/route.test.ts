import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { PATCH } from "../route";

function buildSupabaseMock(existing: Record<string, unknown>) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: existing, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...existing, stop_loss: 95, edited_fields: ["stop_loss"] },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
}

describe("PATCH /api/trade-plans/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks a field as edited when its new value differs from ai_suggested", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({ id: "tp1", stop_loss: 90, ai_suggested: { stop_loss: 90 }, edited_fields: [] }) as never,
    );
    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({ stop_loss: 95 }) });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "tp1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tradePlan.edited_fields).toContain("stop_loss");
  });
});
