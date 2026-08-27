import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildMock(opts: { entries: { quantity: number }[]; existingExits: { quantity: number }[] }) {
  const positionUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "exits") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "ex1", position_id: "p1", quantity: 30, price: 180, type: "trim_t1" },
                error: null,
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: opts.existingExits, error: null }),
          }),
        };
      }
      if (table === "entries") {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: opts.entries, error: null }) }) };
      }
      if (table === "positions") {
        return { update: positionUpdate };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _positionUpdate: positionUpdate,
  };
}

describe("POST /api/positions/[id]/exits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets position status to partial_exit when quantity remains", async () => {
    const mock = buildMock({ entries: [{ quantity: 100 }], existingExits: [] });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 30, price: 180, type: "trim_t1" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.remainingQuantity).toBe(70);
    expect(body.positionStatus).toBe("partial_exit");
    expect(body.promptJournal).toBe(false);
    expect(mock._positionUpdate).toHaveBeenCalledWith({ status: "partial_exit" });
  });

  it("sets position status to closed and prompts a journal entry when quantity reaches zero", async () => {
    const mock = buildMock({ entries: [{ quantity: 100 }], existingExits: [{ quantity: 30 }] });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 70, price: 210, type: "trim_t2" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    const body = await res.json();

    expect(body.remainingQuantity).toBe(0);
    expect(body.positionStatus).toBe("closed");
    expect(body.promptJournal).toBe(true);
    expect(mock._positionUpdate).toHaveBeenCalledWith({ status: "closed" });
  });

  it("rejects an override without a reason of at least 40 characters", async () => {
    const mock = buildMock({ entries: [{ quantity: 100 }], existingExits: [] });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-27", quantity: 100, price: 80, type: "stop_hit", override: true, override_reason: "too short" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });
});
