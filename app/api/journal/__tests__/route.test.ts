import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/llm/budget", () => ({ checkBudget: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

import { generateText } from "ai";
import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

const VERDICT_RAW = `\`\`\`json
{"verdict": "Good discipline overall.", "suggested_tags": ["Indian EV"]}
\`\`\``;

function buildMock(opts: { overrideExit?: boolean } = {}) {
  const journalInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "j1" }, error: null }) }),
  });
  const positionUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "p1", ticker: "AAPL", thesis_id: "t1" }, error: null }) }) }), update: positionUpdate };
      if (table === "entries") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [{ date: "2026-01-01", quantity: 10, price: 100 }], error: null }) }) };
      if (table === "exits") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [{ date: "2026-02-01", quantity: 10, price: 120, override: opts.overrideExit ?? false }], error: null }) }) };
      if (table === "theses") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { market_view: "v", invalidation_condition: "i", conviction_tier: "I" }, error: null }) }) }) };
      if (table === "trade_journal_entries") return { insert: journalInsert };
      throw new Error(`unexpected table ${table}`);
    }),
    _journalInsert: journalInsert,
    _positionUpdate: positionUpdate,
  };
}

describe("POST /api/journal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generate_only returns a preview without persisting", async () => {
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
    vi.mocked(generateText).mockResolvedValue({ text: VERDICT_RAW } as never);
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ position_id: "p1", generate_only: true }) });
    const res = await POST(req as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.verdict).toContain("Good discipline");
    expect(body.autoFilled.pnlPct).toBeCloseTo(20, 1);
  });

  it("persists the review, appends Discipline Break for an overridden exit, and closes the position", async () => {
    const mock = buildMock({ overrideExit: true });
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(generateText).mockResolvedValue({ text: VERDICT_RAW } as never);
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({
        position_id: "p1",
        thesis_outcome: "confirmed",
        entry_quality: 4, sizing_quality: 4, stop_management: 3, exit_quality: 4, discipline_score: 2,
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const inserted = mock._journalInsert.mock.calls[0][0];
    expect(inserted.tags).toContain("Discipline Break");
    expect(mock._positionUpdate).toHaveBeenCalledWith({ status: "closed" });
  });
});
