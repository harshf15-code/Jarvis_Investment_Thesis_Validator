// app/api/signals/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { GET, POST } from "../route";

function buildMock() {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "sig1", priority: "red" }, error: null }) }),
  });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "intelligence_signals") {
        return {
          select: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  { id: "s1", priority: "blue", created_at: "2026-08-20", headline: "b" },
                  { id: "s2", priority: "red", created_at: "2026-08-19", headline: "r" },
                ],
                error: null,
              }),
            }),
          }),
          insert,
        };
      }
      if (table === "positions") return { select: vi.fn().mockReturnValue({}) };
      throw new Error(`unexpected table ${table}`);
    }),
    _insert: insert,
  };
}

describe("GET /api/signals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sorts red before blue regardless of recency", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildMock() as never);
    const res = await GET();
    const body = await res.json();
    expect(body.signals[0].priority).toBe("red");
  });
});

describe("POST /api/signals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a body with no headline", async () => {
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ priority: "blue" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("creates a manual signal", async () => {
    const mock = buildMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ priority: "red", headline: "Margin miss" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    expect(mock._insert).toHaveBeenCalled();
  });
});
