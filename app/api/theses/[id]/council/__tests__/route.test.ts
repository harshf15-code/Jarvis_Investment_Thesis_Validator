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

const MEMO_ID = "memo-1";

/** A memorandum document that satisfies `MemorandumSchema`. */
function memoDocument() {
  const cell = { value: "x", sub: "y" };
  return {
    header: { system_id: "Jarvis", sector_theme: "Robotics", title: "T", data_source: "Yahoo" },
    candidates: [
      {
        ticker: "MKSI", company_name: "MKS", valuation_metric: "34x", market_cap: "$6B",
        operational_share: "12%", verdict: "BUY", tagline: "PICK", is_primary_pick: true,
      },
      {
        ticker: "ROK", company_name: "Rockwell", valuation_metric: "28x", market_cap: "$48B",
        operational_share: "9%", verdict: "WATCH", tagline: "RICH", is_primary_pick: false,
      },
    ],
    primary_ticker: "MKSI",
    secondary_ticker: null,
    execution_status: "ready",
    thesis: {
      section_header: "s", market_view: "mv", mispricing: "mp", catalysts: ["c"],
      peer_commentary: [], time_horizon_invalidation: "t", conviction_score: 70, secondary: null,
    },
    stress_test: { failure_modes: [], verdict: "ok" },
    trade_plan: {
      section_header: "s",
      cells: {
        cmp: cell, entry_zone: cell, add_tranche: cell, stop_loss: cell, target_1: cell,
        target_2: cell, position_size: cell, time_horizon: cell, time_exit: cell,
      },
      numeric: {
        entry_zone_low: 250, entry_zone_high: 260, add_tranche_low: 240, add_tranche_high: 245,
        stop_loss: 230, target_1: 300, target_2: 340, position_size_pct: 4,
        time_exit_date: "2027-01-01", time_exit_condition: "c",
      },
      test_calendar: [], parallel_plan: null,
    },
    exit: {
      section_header: "s", rules: [], warning: null,
      verdict_cells: { risk_reward: cell, max_drawdown: cell, tier: cell, peg: cell },
    },
  };
}

const MEMBERS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Warren Buffett", philosophy: "p".repeat(50), source: "builtin", sort_order: 1 },
  { id: "22222222-2222-4222-8222-222222222222", name: "Howard Marks", philosophy: "p".repeat(50), source: "builtin", sort_order: 2 },
  { id: "33333333-3333-4333-8333-333333333333", name: "Stan Druckenmiller", philosophy: "p".repeat(50), source: "builtin", sort_order: 3 },
];

const ALL_IDS = MEMBERS.map((m) => m.id);

type MockOpts = {
  memo?: unknown;
  candidates?: unknown[];
  members?: unknown[];
};

let upserted: Record<string, unknown> | null = null;

function buildSupabaseMock(opts: MockOpts = {}) {
  const memo =
    opts.memo === undefined
      ? { id: MEMO_ID, thesis_id: "t1", market: "US", document: memoDocument() }
      : opts.memo;
  const candidates =
    opts.candidates ?? [
      { id: "c1", ticker: "MKSI", company_name: "MKS", cmp: 255, fundamentals: {}, range_low: 100, range_high: 300 },
      { id: "c2", ticker: "ROK", company_name: "Rockwell", cmp: 430, fundamentals: {}, range_low: 200, range_high: 500 },
    ];
  const members = opts.members ?? MEMBERS;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "theses") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "t1", input_text: "robotics actuators", markets: ["US", "IN"] },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "thesis_memorandums") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: memo, error: null }) }) }),
          }),
        };
      }
      if (table === "thesis_candidates") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ order: async () => ({ data: candidates, error: null }) }) }),
          }),
        };
      }
      if (table === "council_members") {
        return {
          select: () => ({ in: () => ({ order: async () => ({ data: members, error: null }) }) }),
        };
      }
      if (table === "thesis_council_reports") {
        return {
          upsert: (row: Record<string, unknown>) => {
            upserted = row;
            return {
              select: () => ({
                single: async () => ({ data: { id: "r1", ...row }, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function post(body: unknown, market = "US") {
  return new Request(`http://test/api/theses/t1/council?market=${market}`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "t1" });

function fenced(obj: unknown) {
  return { text: "```json\n" + JSON.stringify(obj) + "\n```" };
}

const OPINION = {
  verdict: "WATCH",
  preferred_ticker: "ROK",
  headline: "h",
  reasoning: "r",
  biggest_risk: "b",
};

const SYNTHESIS = {
  combined_verdict: "WATCH",
  summary: "Split.",
  where_they_agree: ["a"],
  where_they_diverge: ["d"],
};

beforeEach(() => {
  vi.clearAllMocks();
  upserted = null;
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
  vi.mocked(createClient).mockResolvedValue(buildSupabaseMock() as never);
  vi.mocked(generateText).mockResolvedValue(fenced(OPINION) as never);
});

describe("POST /api/theses/[id]/council", () => {
  it("rejects a panel below the 3-member minimum", async () => {
    const res = await POST(post({ member_ids: ALL_IDS.slice(0, 2) }), { params });
    expect(res.status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects a panel above the 7-member cap", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`);
    const res = await POST(post({ member_ids: eight }), { params });
    expect(res.status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects duplicate members rather than billing for the same call twice", async () => {
    const res = await POST(post({ member_ids: [ALL_IDS[0], ALL_IDS[0], ALL_IDS[1]] }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects a market the thesis was not created for", async () => {
    const res = await POST(post({ member_ids: ALL_IDS }, "IN"), { params });
    expect(res.status).not.toBe(400); // IN is one of the thesis's markets
    const other = await POST(post({ member_ids: ALL_IDS }, "CN"), { params });
    expect(other.status).toBe(400);
  });

  it("409s when there is no memorandum to review", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock({ memo: null }) as never);
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/analysis first/i);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("409s on a memorandum written in an older format", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildSupabaseMock({ memo: { id: MEMO_ID, document: { header: {} } } }) as never,
    );
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(409);
  });

  it("400s when a chosen member no longer exists", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildSupabaseMock({ members: MEMBERS.slice(0, 2) }) as never,
    );
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(400);
  });

  it("costs exactly N+1 model calls", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(SYNTHESIS) as never);

    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(200);
    expect(generateText).toHaveBeenCalledTimes(4);

    const doc = upserted!.document as { opinions: unknown[]; synthesis: unknown };
    expect(doc.opinions).toHaveLength(3);
    expect(doc.synthesis).not.toBeNull();
    expect(upserted!.memorandum_id).toBe(MEMO_ID);
  });

  it("keeps the other members and still synthesizes when one call fails", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockRejectedValueOnce(new Error("upstream 503"))
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(SYNTHESIS) as never);

    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(200);

    const doc = upserted!.document as {
      opinions: { member_name: string; opinion: unknown; error: string | null }[];
      synthesis: unknown;
    };
    // The failed member keeps a card, carrying the reason — never a blank one.
    const failed = doc.opinions.find((o) => o.opinion === null)!;
    expect(failed.error).toContain("503");
    expect(failed.member_name).toBe("Howard Marks");
    expect(doc.opinions.filter((o) => o.opinion !== null)).toHaveLength(2);
    expect(doc.synthesis).not.toBeNull();
  });

  it("skips the synthesis call when only one member answered", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"));

    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(200);
    // 3 member calls and NO fourth: restating one card is spend without information.
    expect(generateText).toHaveBeenCalledTimes(3);
    expect((upserted!.document as { synthesis: unknown }).synthesis).toBeNull();
  });

  it("502s when no member answered at all", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("upstream down"));
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(502);
    expect(upserted).toBeNull();
  });

  it("nulls a preferred ticker the member invented", async () => {
    // A persona naming a stock nobody priced would render a buy-shaped
    // recommendation for something that cannot be entered, sized or exited.
    vi.mocked(generateText)
      .mockResolvedValueOnce(fenced({ ...OPINION, preferred_ticker: "FANUY" }) as never)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(SYNTHESIS) as never);

    await POST(post({ member_ids: ALL_IDS }), { params });
    const doc = upserted!.document as {
      opinions: { opinion: { preferred_ticker: string | null; reasoning: string | null } | null }[];
    };
    expect(doc.opinions[0].opinion!.preferred_ticker).toBeNull();
    expect(doc.opinions[0].opinion!.reasoning).toBe("r");
    expect(doc.opinions[1].opinion!.preferred_ticker).toBe("ROK");
  });

  it("survives an unparseable synthesis without losing the opinions", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce(fenced(OPINION) as never)
      .mockResolvedValueOnce({ text: "no json here" } as never);

    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(200);
    const doc = upserted!.document as { opinions: unknown[]; synthesis: unknown };
    expect(doc.synthesis).toBeNull();
    expect(doc.opinions).toHaveLength(3);
  });
});

describe("spend guard", () => {
  it("refuses with 429 and spends nothing when over budget", async () => {
    // The point of the pre-flight check: an account that is over budget must
    // cost zero, not "one more request's worth".
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false,
      window: "daily",
      message: "You've used $1.00 of your $1.00 daily analysis budget.",
    } as never);
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/daily analysis budget/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("503s and spends nothing when the budget cannot be read", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false,
      window: "unavailable",
      message: "Couldn't check your analysis budget just now — try again in a moment.",
    } as never);
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(503);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("401s a request with no session", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await POST(post({ member_ids: ALL_IDS }), { params });
    expect(res.status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });
});
