import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/market-data", () => ({
  getHoldingSnapshot: vi.fn(),
  getQuote: vi.fn(),
}));
vi.mock("@/lib/llm/budget", () => ({ checkBudget: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { checkBudget } from "@/lib/llm/budget";
import { getHoldingSnapshot, getQuote } from "@/lib/market-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

const SECRET = "watch-secret";

const READ = {
  headline: "Nothing has broken.",
  still_intact: true,
  what_changed: "Margins slipped.",
  what_to_watch: "The next print.",
  lean: "STAY",
  grounded_in: ["Profit margin 20% -> 10%"],
};

const fenced = (o: unknown) => ({ text: "```json\n" + JSON.stringify(o) + "\n```" });

type Captured = {
  reviews: Record<string, unknown>[];
  signals: Record<string, unknown>[];
  watchUpserts: Record<string, unknown>[];
  watchDeletes: string[];
};

/**
 * One chainable stub keyed on table name. The drain reads
 * `holding_watch_state` and `positions`, then `reviewHolding` reads the
 * position bundle and writes the review, the signal and the state.
 */
function buildAdminMock(opts: {
  pending?: { position_id: string; user_id: string; last_checked_at: string | null }[];
  eligible?: { id: string; thesis_id: string }[];
  state?: Record<string, unknown> | null;
  thesisText?: string;
  captured: Captured;
}) {
  const pending = opts.pending ?? [
    { position_id: "pos-1", user_id: "user-1", last_checked_at: null },
  ];
  const eligible = opts.eligible ?? [{ id: "pos-1", thesis_id: "th-1" }];

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "holding_watch_state") {
      return {
        select: () => ({
          or: () => ({
            order: () => ({ limit: async () => ({ data: pending, error: null }) }),
          }),
          eq: () => ({ maybeSingle: async () => ({ data: opts.state ?? null, error: null }) }),
        }),
        upsert: async (row: Record<string, unknown>) => {
          opts.captured.watchUpserts.push(row);
          return { error: null };
        },
        delete: () => ({
          eq: async (_col: string, id: string) => {
            opts.captured.watchDeletes.push(id);
            return { error: null };
          },
        }),
      };
    }
    if (table === "positions") {
      return {
        select: () => ({
          in: () => ({
            in: () => ({ eq: async () => ({ data: eligible, error: null }) }),
          }),
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "pos-1", ticker: "INFY", thesis_id: "th-1", stock_id: "st-1", status: "active" },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "theses") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "th-1", input_text: opts.thesisText ?? "Cheap IT compounder.", source: "imported" },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "stocks") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ticker: "INFY", yahoo_symbol: "INFY.NS", currency: "INR", last_price: 1200 },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "entries") {
      return {
        select: () => ({
          eq: async () => ({ data: [{ quantity: 10, price: 1400, date: "2026-08-01" }], error: null }),
        }),
      };
    }
    if (table === "portfolio_profiles") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    }
    if (table === "holding_reviews") {
      return {
        insert: (row: Record<string, unknown>) => {
          opts.captured.reviews.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "rev-1" }, error: null }) }) };
        },
      };
    }
    if (table === "intelligence_signals") {
      return {
        insert: async (row: Record<string, unknown>) => {
          opts.captured.signals.push(row);
          return { error: null };
        },
      };
    }
    if (table === "llm_usage") {
      return { insert: async () => ({ error: null }) };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

function post(secret: string | null = SECRET) {
  return new Request("http://test/api/portfolio/holding-watch", {
    method: "POST",
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

function captured(): Captured {
  return { reviews: [], signals: [], watchUpserts: [], watchDeletes: [] };
}

describe("POST /api/portfolio/holding-watch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOLDING_WATCH_SECRET = SECRET;
    vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
    vi.mocked(getQuote).mockResolvedValue({
      price: 1200, asOf: new Date(), name: "Infosys", currency: "INR",
    } as never);
    vi.mocked(generateText).mockResolvedValue(fenced(READ) as never);
  });

  it("401s without the secret, and spends nothing", async () => {
    expect((await POST(post(null))).status).toBe(401);
    expect((await POST(post("wrong-secret-xx"))).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses to run when no secret is configured, rather than failing open", async () => {
    // An unauthenticated route that spends model calls for every account on
    // the instance is not something to fail open on.
    delete process.env.HOLDING_WATCH_SECRET;
    expect((await POST(post())).status).toBe(401);
  });

  it("reviews a never-checked holding and does not put it in the Feed", async () => {
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(buildAdminMock({ captured: cap }) as never);
    vi.mocked(getHoldingSnapshot).mockResolvedValue({
      fundamentals: { trailingPE: 20 }, earningsDates: [], earningsDateIsEstimate: false,
    } as never);

    const body = await (await POST(post())).json();

    expect(body).toMatchObject({ checked: 1, reviewed: 1, flagged: 0 });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(cap.reviews[0]).toMatchObject({ trigger: "manual", position_id: "pos-1" });
    // The initial read is already on the position page where it was asked for.
    expect(cap.signals).toEqual([]);
    expect(cap.watchUpserts[0].last_checked_at).toBeTruthy();
  });

  it("spends NOTHING when a checked holding has not moved", async () => {
    // The branch that makes a weekly watch over a large book affordable.
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminMock({
        captured: cap,
        pending: [{ position_id: "pos-1", user_id: "user-1", last_checked_at: "2026-08-01T00:00:00Z" }],
        state: {
          position_id: "pos-1", last_checked_at: "2026-08-01T00:00:00Z",
          fundamentals: { trailingPE: 20 }, next_earnings_date: null, last_earnings_seen: null,
        },
      }) as never,
    );
    vi.mocked(getHoldingSnapshot).mockResolvedValue({
      fundamentals: { trailingPE: 20.5 }, earningsDates: [], earningsDateIsEstimate: false,
    } as never);

    const body = await (await POST(post())).json();

    expect(body).toMatchObject({ checked: 1, reviewed: 0, unchanged: 1 });
    expect(generateText).not.toHaveBeenCalled();
    expect(cap.reviews).toEqual([]);
    // It still records that it looked, so the holding is not re-checked hourly.
    expect(cap.watchUpserts[0].last_checked_at).toBeTruthy();
  });

  it("reviews and flags a holding whose fundamentals moved", async () => {
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminMock({
        captured: cap,
        pending: [{ position_id: "pos-1", user_id: "user-1", last_checked_at: "2026-08-01T00:00:00Z" }],
        state: {
          position_id: "pos-1", last_checked_at: "2026-08-01T00:00:00Z",
          fundamentals: { profitMargins: 0.2 }, next_earnings_date: null, last_earnings_seen: null,
        },
      }) as never,
    );
    vi.mocked(getHoldingSnapshot).mockResolvedValue({
      fundamentals: { profitMargins: 0.1 }, earningsDates: [], earningsDateIsEstimate: false,
    } as never);

    const body = await (await POST(post())).json();

    expect(body).toMatchObject({ reviewed: 1, flagged: 1 });
    expect(cap.reviews[0]).toMatchObject({ trigger: "fundamentals_delta" });
    expect(cap.signals[0]).toMatchObject({ ticker: "INFY", priority: "blue", user_id: "user-1" });
    expect(cap.signals[0].headline).toMatch(/profit margin moved/);
  });

  it("skips an over-budget user WITHOUT marking them checked", async () => {
    // Marking it checked would mean the holding silently waits another full
    // week after the budget resets.
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(buildAdminMock({ captured: cap }) as never);
    vi.mocked(getHoldingSnapshot).mockResolvedValue({
      fundamentals: {}, earningsDates: [], earningsDateIsEstimate: false,
    } as never);
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false, window: "daily", message: "You've used $1.00 of your $1.00 daily analysis budget.",
    } as never);

    const body = await (await POST(post())).json();

    expect(body).toMatchObject({ checked: 1, skipped: 1, reviewed: 0 });
    expect(generateText).not.toHaveBeenCalled();
    expect(cap.watchUpserts).toEqual([]);
  });

  it("checks the budget per user, not once for the batch", async () => {
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminMock({
        captured: cap,
        pending: [
          { position_id: "pos-1", user_id: "user-1", last_checked_at: null },
          { position_id: "pos-2", user_id: "user-2", last_checked_at: null },
        ],
        eligible: [
          { id: "pos-1", thesis_id: "th-1" },
          { id: "pos-2", thesis_id: "th-1" },
        ],
      }) as never,
    );
    vi.mocked(getHoldingSnapshot).mockResolvedValue({
      fundamentals: {}, earningsDates: [], earningsDateIsEstimate: false,
    } as never);

    await POST(post());

    expect(vi.mocked(checkBudget).mock.calls.map((c) => c[0])).toEqual(["user-1", "user-2"]);
  });

  it("drops a closed holding from the queue instead of draining it forever", async () => {
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminMock({ captured: cap, eligible: [] }) as never,
    );

    const body = await (await POST(post())).json();

    expect(body).toMatchObject({ checked: 0, reviewed: 0 });
    expect(cap.watchDeletes).toEqual(["pos-1"]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("keeps going when one holding throws", async () => {
    const cap = captured();
    vi.mocked(createAdminClient).mockReturnValue(
      buildAdminMock({
        captured: cap,
        pending: [
          { position_id: "pos-1", user_id: "user-1", last_checked_at: null },
          { position_id: "pos-2", user_id: "user-1", last_checked_at: null },
        ],
        eligible: [
          { id: "pos-1", thesis_id: "th-1" },
          { id: "pos-2", thesis_id: "th-1" },
        ],
      }) as never,
    );
    vi.mocked(getHoldingSnapshot)
      .mockRejectedValueOnce(new Error("Yahoo is unhappy"))
      .mockResolvedValue({
        fundamentals: {}, earningsDates: [], earningsDateIsEstimate: false,
      } as never);

    const body = await (await POST(post())).json();

    expect(body).toMatchObject({ checked: 2, failed: 1, reviewed: 1 });
  });
});
