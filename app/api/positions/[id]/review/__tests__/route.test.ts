import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/llm/budget", () => ({ checkBudget: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));
vi.mock("@/lib/market-data", () => ({ getHoldingSnapshot: vi.fn(), getQuote: vi.fn() }));

import { generateText } from "ai";
import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { getHoldingSnapshot, getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

const READ = {
  headline: "Still fine.",
  still_intact: true,
  what_changed: "Nothing material.",
  what_to_watch: "The next print.",
  lean: "STAY",
  grounded_in: ["Trailing P/E 20"],
};

const fenced = (o: unknown) => ({ text: "```json\n" + JSON.stringify(o) + "\n```" });

const captured = { reviews: [] as Record<string, unknown>[], signals: [] as Record<string, unknown>[] };

function buildMock(opts: { thesisText?: string; exits?: { quantity: number }[] } = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return {
          select: () => ({
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
                data: {
                  id: "th-1",
                  input_text:
                    opts.thesisText ?? "Imported holding — INFY. No stated reason recorded at import.",
                  source: "imported",
                },
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
      if (table === "exits") {
        return {
          select: () => ({
            eq: async () => ({ data: opts.exits ?? [], error: null }),
          }),
        };
      }
      if (table === "portfolio_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      if (table === "holding_watch_state") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          upsert: async () => ({ error: null }),
        };
      }
      if (table === "holding_reviews") {
        return {
          insert: (row: Record<string, unknown>) => {
            captured.reviews.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "rev-1" }, error: null }) }) };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: async () => ({ data: { id: "rev-1" }, error: null }) }),
              }),
            }),
          }),
        };
      }
      if (table === "intelligence_signals") {
        return {
          insert: async (row: Record<string, unknown>) => {
            captured.signals.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const params = Promise.resolve({ id: "pos-1" });
const post = () => new Request("http://test/api/positions/pos-1/review", { method: "POST" });

describe("POST /api/positions/[id]/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.reviews.length = 0;
    captured.signals.length = 0;
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
    vi.mocked(getQuote).mockResolvedValue({ price: 1200, asOf: new Date(), name: "Infosys", currency: "INR" } as never);
    vi.mocked(getHoldingSnapshot).mockResolvedValue({
      fundamentals: { trailingPE: 20 }, earningsDates: [], earningsDateIsEstimate: false,
    } as never);
    vi.mocked(generateText).mockResolvedValue(fenced(READ) as never);
  });

  it("401s with no session and spends nothing", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await POST(post(), { params })).status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("429s when over budget and spends nothing", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false, window: "daily", message: "You've used $1.00 of your $1.00 daily analysis budget.",
    } as never);
    const res = await POST(post(), { params });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/daily analysis budget/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("503s when the budget cannot be read", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false, window: "unavailable", message: "Couldn't check your analysis budget just now — try again in a moment.",
    } as never);
    expect((await POST(post(), { params })).status).toBe(503);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("runs a read even though nothing moved, because the trader asked", async () => {
    // The one difference between this path and the scheduled one.
    const res = await POST(post(), { params });
    expect(res.status).toBe(201);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(captured.reviews[0]).toMatchObject({ trigger: "manual", user_id: "user-1" });
  });

  it("does not put a read the trader asked for into the Feed", async () => {
    // It is already on the screen they asked from. The Feed is for things that
    // need attention, not a log of everything Jarvis has ever said.
    await POST(post(), { params });
    expect(captured.signals).toEqual([]);
  });

  it("does not feed the import placeholder to the model as a stated thesis", async () => {
    // `theses.input_text` is NOT NULL, so an import writes a placeholder there.
    // Passing it through would have the model solemnly assess "Imported
    // holding — INFY" as a reason to own something.
    await POST(post(), { params });
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("They did not record a reason");
    expect(prompt).not.toContain("No stated reason recorded at import");
  });

  it("passes the trader's own words through when they gave any", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({ thesisText: "Bought for the cash conversion." }) as never,
    );
    await POST(post(), { params });
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Bought for the cash conversion.");
  });

  it("reviews the quantity still held, not the quantity ever bought", async () => {
    // A partial_exit position trimmed from 10 shares to 4 is 4 shares of
    // capital at risk. Reviewing it as 10 overstates the position the read is
    // about — and the scheduler deliberately keeps watching partial exits, so
    // this is their normal case.
    vi.mocked(createClient).mockResolvedValue(buildMock({ exits: [{ quantity: 6 }] }) as never);
    await POST(post(), { params });
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Quantity: 4");
  });

  it("fails rather than reviewing a position whose entries could not be read", async () => {
    // Supabase resolves with an `error` field rather than throwing, so
    // ignoring it would turn a database failure into a zero-quantity position
    // reviewed and saved as though it were real.
    const mock = buildMock();
    const realFrom = mock.from;
    mock.from = vi.fn().mockImplementation((table: string) => {
      if (table === "entries") {
        return { select: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) };
      }
      return realFrom(table);
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(post(), { params });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/entries/);
    expect(generateText).not.toHaveBeenCalled();
    expect(captured.reviews).toEqual([]);
  });

  it("500s rather than saving a review it could not parse", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "no json here" } as never);
    expect((await POST(post(), { params })).status).toBe(500);
    expect(captured.reviews).toEqual([]);
  });
});
