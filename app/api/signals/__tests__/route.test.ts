// app/api/signals/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
import { GET, POST } from "../route";

type Signal = { id: string; priority: string; created_at: string; headline: string; archived_at?: string | null };
type Position = { id: string; ticker: string; trade_plan_id: string };
type TradePlan = { id: string; time_exit_date: string | null };

function buildMock(options?: { signals?: Signal[]; positions?: Position[]; tradePlans?: TradePlan[] }) {
  const signals = options?.signals ?? [
    { id: "s1", priority: "blue", created_at: "2026-08-20", headline: "b" },
    { id: "s2", priority: "red", created_at: "2026-08-19", headline: "r" },
  ];
  const positions = options?.positions ?? [];
  const tradePlans = options?.tradePlans ?? [];

  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "sig1", priority: "red" }, error: null }) }),
  });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "intelligence_signals") {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: signals, error: null }),
          }),
          insert,
        };
      }
      if (table === "positions") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: positions, error: null }),
          }),
        };
      }
      if (table === "trade_plans") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: tradePlans, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _insert: insert,
  };
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("GET /api/signals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sorts red before blue regardless of recency", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
    const res = await GET();
    const body = await res.json();
    expect(body.signals[0].priority).toBe("red");
  });

  it("returns both active and archived signals, archived sorted by archived_at descending", async () => {
    const mock = buildMock({
      signals: [
        { id: "a1", priority: "blue", created_at: "2026-08-10", headline: "old archived", archived_at: "2026-08-11" },
        { id: "s1", priority: "blue", created_at: "2026-08-20", headline: "active" },
        { id: "a2", priority: "red", created_at: "2026-08-15", headline: "newer archived", archived_at: "2026-08-20" },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);
    const res = await GET();
    const body = await res.json();
    const ids = body.signals.map((s: Signal) => s.id);
    // Active signal(s) first (unarchived, priority-sorted), then archived
    // ones ordered newest-reviewed first — the tab split on the client
    // separates them visually, so only within-group order matters here.
    expect(ids).toEqual(["s1", "a2", "a1"]);
  });

  it("includes a position's time-exit date in the agenda when it falls within 14 days, and excludes one that doesn't", async () => {
    const mock = buildMock({
      signals: [],
      positions: [
        { id: "p1", ticker: "AAA", trade_plan_id: "tp1" },
        { id: "p2", ticker: "BBB", trade_plan_id: "tp2" },
      ],
      tradePlans: [
        { id: "tp1", time_exit_date: daysFromNow(5) },
        { id: "tp2", time_exit_date: daysFromNow(30) },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);
    const res = await GET();
    const body = await res.json();
    expect(body.agenda).toEqual([{ ticker: "AAA", timeExitDate: daysFromNow(5) }]);
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
    vi.mocked(createClient).mockResolvedValue(mock as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ priority: "red", headline: "Margin miss" }) });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    expect(mock._insert).toHaveBeenCalled();
  });
});
