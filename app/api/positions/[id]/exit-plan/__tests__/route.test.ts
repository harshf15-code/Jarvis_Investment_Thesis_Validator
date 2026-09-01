import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/llm/budget", () => ({ checkBudget: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// `meteredGenerateText` is NOT mocked — only `ai` beneath it — so the ledger
// rows it writes are real and can be asserted on.
const ledger: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "llm_usage") ledger.push(row);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/market-data", () => ({ getHoldingSnapshot: vi.fn(), getQuote: vi.fn() }));

import { generateText } from "ai";
import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { getHoldingSnapshot, getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { PATCH, POST } from "../route";

const PROPOSAL = {
  stop_loss: 3800,
  target_1: 5200,
  target_2: 6000,
  time_exit_date: null,
  time_exit_condition: null,
  reasoning: {
    stop_loss: "Below it, the order-book story is not being believed.",
    target_1: "A re-rate to the sector's median multiple.",
    target_2: "If the capex cycle runs its full length.",
    time_exit: null,
  },
  grounded_in: ["Trailing P/E 32", "Average cost 4000 INR"],
};

const fenced = (o: unknown) => ({ text: "```json\n" + JSON.stringify(o) + "\n```" });

const RATIONALE = "Defence order book and the government capex cycle.";

const captured = { planUpdates: [] as Record<string, unknown>[] };

function buildMock(opts: { source?: string; thesisText?: string | null } = {}) {
  const source = opts.source ?? "imported";
  const input_text = opts.thesisText === undefined ? RATIONALE : opts.thesisText;
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "pos-1",
                  ticker: "HAL",
                  thesis_id: "th-1",
                  stock_id: "st-1",
                  status: "active",
                  trade_plan_id: "tp-1",
                },
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
              maybeSingle: async () => ({ data: { id: "th-1", input_text, source }, error: null }),
            }),
          }),
        };
      }
      if (table === "stocks") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { ticker: "HAL", yahoo_symbol: "HAL.NS", currency: "INR", last_price: 4400 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "entries") {
        return {
          select: () => ({
            eq: async () => ({ data: [{ quantity: 10, price: 4000, date: "2026-01-15" }], error: null }),
          }),
        };
      }
      if (table === "exits") return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      if (table === "portfolio_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      if (table === "holding_watch_state") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      if (table === "trade_plans") {
        return {
          update: (row: Record<string, unknown>) => {
            captured.planUpdates.push(row);
            return {
              eq: () => ({
                select: () => ({ single: async () => ({ data: { id: "tp-1", ...row }, error: null }) }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const params = Promise.resolve({ id: "pos-1" });
const req = () => new Request("http://test/api/positions/pos-1/exit-plan", { method: "POST" });
const patchReq = (body: unknown) =>
  new Request("http://test/api/positions/pos-1/exit-plan", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const LEVELS = {
  stop_loss: 3800,
  target_1: 5200,
  target_2: 6000,
  time_exit_date: null,
  time_exit_condition: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  ledger.length = 0;
  captured.planUpdates.length = 0;
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
  vi.mocked(createClient).mockResolvedValue(buildMock() as never);
  vi.mocked(getHoldingSnapshot).mockResolvedValue({
    fundamentals: { trailingPE: 32 },
    earningsDates: [],
    earningsDateIsEstimate: false,
  } as never);
  vi.mocked(getQuote).mockResolvedValue({ price: 4500, asOf: new Date(), name: null, currency: "INR" } as never);
  vi.mocked(generateText).mockResolvedValue(fenced(PROPOSAL) as never);
});

describe("POST /api/positions/[id]/exit-plan", () => {
  it("proposes levels grounded in the stated reason, and writes nothing", async () => {
    const res = await POST(req(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proposal.stop_loss).toBe(3800);
    expect(body.currentPrice).toBe(4500);
    expect(body.quantity).toBe(10);
    expect(generateText).toHaveBeenCalledTimes(1);
    // Nothing was created, so it must not read as created — and above all, no
    // level may reach `trade_plans` before the trader has seen it.
    expect(captured.planUpdates).toHaveLength(0);

    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain(RATIONALE);
    expect(prompt).toContain("The current price is 4500 INR");
  });

  it("labels the call in the spend ledger", async () => {
    await POST(req(), { params });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ feature: "imported_exit_plan", thesis_id: "th-1" });
  });

  it("refuses when not signed in", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await POST(req(), { params });
    expect(res.status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses, and spends nothing, when the trader is over budget", async () => {
    vi.mocked(checkBudget).mockResolvedValue({ ok: false, window: "daily", message: "Daily cap reached." } as never);
    const res = await POST(req(), { params });
    expect(res.status).toBe(429);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("answers 503, not 429, when spend is unknown rather than exhausted", async () => {
    vi.mocked(checkBudget).mockResolvedValue({ ok: false, window: "unavailable", message: "Can't tell." } as never);
    const res = await POST(req(), { params });
    expect(res.status).toBe(503);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses a Jarvis-originated position, which already has a plan behind it", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ source: "jarvis" }) as never);
    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/memorandum/i);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses when no reason has been recorded, rather than anchoring a stop to nothing", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({ thesisText: "Imported holding — HAL. No stated reason recorded at import." }) as never,
    );
    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/why you own this/i);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses when the holding cannot be priced at all", async () => {
    vi.mocked(getQuote).mockRejectedValue(new Error("no quote"));
    // The cached `stocks.last_price` fallback is stripped too, so there is
    // genuinely no price to set levels against.
    const mock = buildMock();
    const original = mock.from.getMockImplementation()!;
    mock.from.mockImplementation((table: string) =>
      table === "stocks"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { ticker: "HAL", yahoo_symbol: "HAL.NS", currency: "INR", last_price: null },
                  error: null,
                }),
              }),
            }),
          }
        : original(table),
    );
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no current price/i);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("does not hand back an unparseable answer as a plan", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "I could not do this." } as never);
    const res = await POST(req(), { params });
    expect(res.status).toBe(500);
    expect(captured.planUpdates).toHaveLength(0);
  });

  it("nulls a proposed level that cannot hold, rather than showing it", async () => {
    // A stop above the current price would fire on save.
    vi.mocked(generateText).mockResolvedValue(fenced({ ...PROPOSAL, stop_loss: 4800 }) as never);
    const res = await POST(req(), { params });
    expect((await res.json()).proposal.stop_loss).toBeNull();
  });

  it("never looks at the existing plan, which is what lets a rebuild through", async () => {
    const mock = buildMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(generateText).toHaveBeenCalledTimes(1);
    // The PRD allows rebuilding an exit plan: the panel confirms the overwrite
    // first, and the route stays open. `hasExitLevels` is the panel's predicate
    // for build-vs-rebuild copy, never a refusal here. If someone later adds a
    // "levels are already set" guard, this is the test they have to argue with.
    expect(mock.from).not.toHaveBeenCalledWith("trade_plans");
    expect(captured.planUpdates).toHaveLength(0);
  });
});

describe("PATCH /api/positions/[id]/exit-plan", () => {
  it("saves the approved levels with what Jarvis proposed alongside them", async () => {
    const res = await PATCH(patchReq({ approved: LEVELS, proposed: LEVELS }), { params });
    expect(res.status).toBe(200);

    const write = captured.planUpdates[0];
    expect(write).toMatchObject({ stop_loss: 3800, target_1: 5200, target_2: 6000 });
    expect(write.ai_suggested).toMatchObject({ stop_loss: 3800 });
    // Saved exactly as proposed, so nothing is marked as the trader's own.
    expect(write.edited_fields).toEqual([]);
  });

  it("records which levels the trader changed", async () => {
    await PATCH(
      patchReq({ approved: { ...LEVELS, stop_loss: 3500, target_2: null }, proposed: LEVELS }),
      { params },
    );
    expect(captured.planUpdates[0].edited_fields).toEqual(["stop_loss", "target_2"]);
    // `ai_suggested` keeps Jarvis's original, not what was submitted — that is
    // the whole point of storing it.
    expect(captured.planUpdates[0].ai_suggested).toMatchObject({ stop_loss: 3800, target_2: 6000 });
  });

  it("refuses a stop the price watch would fire on immediately", async () => {
    // The cached price is 4400. `poll-prices` breaches on `price <= stop_loss`,
    // so a stop of 4500 would raise "your stop is broken, get out" on the very
    // next run — against a position that is fine.
    const res = await PATCH(
      patchReq({ approved: { ...LEVELS, stop_loss: 4500 }, proposed: LEVELS }),
      { params },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at or above the current price/i);
    expect(captured.planUpdates).toHaveLength(0);
  });

  it("saves a target the holding has already passed", async () => {
    // Deliberately allowed where the stop is not: "I am past 4200, tell me to
    // trim" is a real instruction, and the ladder showing HIT is the truth.
    const res = await PATCH(
      patchReq({ approved: { ...LEVELS, target_1: 4200, target_2: 4300 }, proposed: LEVELS }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(captured.planUpdates[0]).toMatchObject({ target_1: 4200 });
  });

  it("refuses the trader's own inconsistent numbers instead of dropping them", async () => {
    const res = await PATCH(
      patchReq({ approved: { ...LEVELS, stop_loss: 5500 }, proposed: LEVELS }),
      { params },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/below your first target/i);
    // Nothing partial was written.
    expect(captured.planUpdates).toHaveLength(0);
  });

  it("refuses when not signed in", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await PATCH(patchReq({ approved: LEVELS, proposed: LEVELS }), { params });
    expect(res.status).toBe(401);
    expect(captured.planUpdates).toHaveLength(0);
  });

  it("refuses a Jarvis-originated position", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ source: "jarvis" }) as never);
    const res = await PATCH(patchReq({ approved: LEVELS, proposed: LEVELS }), { params });
    expect(res.status).toBe(400);
    expect(captured.planUpdates).toHaveLength(0);
  });

  it("rejects a body it does not recognise before touching the database", async () => {
    const res = await PATCH(patchReq({ approved: { stop_loss: 1 } }), { params });
    expect(res.status).toBe(400);
    expect(captured.planUpdates).toHaveLength(0);
  });

  it("does not spend a model call", async () => {
    await PATCH(patchReq({ approved: LEVELS, proposed: LEVELS }), { params });
    expect(generateText).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(0);
  });

  it("a rebuild re-diffs against the new proposal, not the old one", async () => {
    // Second time round Jarvis proposes a tighter stop. The trader takes the
    // stop but overrides target_1. `edited_fields` must describe THIS proposal
    // — a rebuild that kept diffing against the first build's numbers would
    // mark levels as edited that the trader never touched.
    const rebuilt = {
      stop_loss: 4100,
      target_1: 5400,
      target_2: 6200,
      time_exit_date: null,
      time_exit_condition: null,
    };
    const approved = { ...rebuilt, target_1: 5000 };
    const res = await PATCH(patchReq({ approved, proposed: rebuilt }), { params });

    expect(res.status).toBe(200);
    expect(captured.planUpdates).toHaveLength(1);
    expect(captured.planUpdates[0]).toMatchObject({
      stop_loss: 4100,
      target_1: 5000,
      target_2: 6200,
      ai_suggested: rebuilt,
      edited_fields: ["target_1"],
    });
  });
});
