import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/llm/openrouter", () => ({
  JARVIS_MODEL_ID: "anthropic/claude-sonnet-4.5",
  jarvisModel: {},
  takeReportedCost: vi.fn(),
  takeMostRecentUnclaimed: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { takeMostRecentUnclaimed, takeReportedCost } from "@/lib/llm/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";
import { meteredGenerateText } from "@/lib/llm/meter";

let rows: Record<string, unknown>[] = [];
let insertFails = false;

function adminMock() {
  return {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table !== "llm_usage") throw new Error(`unexpected table ${table}`);
        if (insertFails) return { error: { message: "ledger is down" } };
        rows.push(row);
        return { error: null };
      },
    }),
  };
}

function result(over: Record<string, unknown> = {}) {
  return {
    text: "ok",
    response: { id: "gen-1" },
    usage: { inputTokens: 1000, outputTokens: 500 },
    ...over,
  };
}

const CALL = { userId: "u1", feature: "memorandum" as const, system: "s", prompt: "p" };

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  insertFails = false;
  vi.mocked(createAdminClient).mockImplementation(adminMock as never);
  vi.mocked(generateText).mockResolvedValue(result() as never);
  vi.mocked(takeReportedCost).mockReturnValue(null);
  vi.mocked(takeMostRecentUnclaimed).mockReturnValue(null);
});

describe("meteredGenerateText", () => {
  it("prefers OpenRouter's reported cost over a token estimate", () => {
    vi.mocked(takeReportedCost).mockReturnValue({
      cost: 0.0731,
      model: "anthropic/claude-sonnet-4.5",
    });
    return meteredGenerateText(CALL).then(() => {
      expect(rows[0]).toMatchObject({ cost_usd: 0.0731, cost_source: "reported" });
    });
  });

  it("falls back to an estimate, labelled as one, when no cost was reported", async () => {
    // The AI SDK strips OpenRouter's `usage.cost` during response validation, so
    // this path is real, not theoretical — it is what happens whenever the fetch
    // interceptor misses a response.
    await meteredGenerateText(CALL);
    expect(rows[0].cost_source).toBe("estimated");
    expect(rows[0].cost_usd as number).toBeGreaterThan(0);
  });

  it("records the tokens, feature, model and thesis attribution", async () => {
    await meteredGenerateText({ ...CALL, thesisId: "t1" });
    expect(rows[0]).toMatchObject({
      user_id: "u1",
      feature: "memorandum",
      thesis_id: "t1",
      generation_id: "gen-1",
      input_tokens: 1000,
      output_tokens: 500,
      ok: true,
    });
  });

  it("records a failed call with ok:false and still rethrows", async () => {
    // A call that threw can still be billed upstream. Skipping it would leave a
    // hole in the very number the budget check reads.
    vi.mocked(generateText).mockRejectedValue(new Error("upstream 503"));
    await expect(meteredGenerateText(CALL)).rejects.toThrow("upstream 503");
    expect(rows[0]).toMatchObject({ ok: false, cost_usd: 0, feature: "memorandum" });
  });

  it("books a charge that arrived before the SDK rejected the response", async () => {
    // OpenRouter can return a fully billable response the SDK then refuses to
    // validate. The charge is real and was already captured on the wire; if the
    // error path booked $0, a repeatable validation failure would never reach
    // the cap.
    vi.mocked(generateText).mockRejectedValue(new Error("could not parse response"));
    vi.mocked(takeMostRecentUnclaimed).mockReturnValue({
      cost: 0.019,
      model: "anthropic/claude-sonnet-4.5",
    });
    await expect(meteredGenerateText(CALL)).rejects.toThrow();
    expect(rows[0]).toMatchObject({ ok: false, cost_usd: 0.019, cost_source: "reported" });
  });

  it("does not fail the request when the ledger write fails", async () => {
    // The money is already spent. Losing the memorandum the user paid for, in
    // order to record that they paid for it, is the wrong trade.
    insertFails = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await meteredGenerateText(CALL);
    expect(r.text).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("FAILED TO RECORD SPEND"),
      expect.anything(),
    );
    spy.mockRestore();
  });

  it("survives a response with no usage block", async () => {
    vi.mocked(generateText).mockResolvedValue(
      result({ usage: undefined, response: undefined }) as never,
    );
    await meteredGenerateText(CALL);
    expect(rows[0]).toMatchObject({ input_tokens: 0, output_tokens: 0, generation_id: null });
  });
});

describe("duration (0026)", () => {
  /** Holds `generateText` open for `ms` so the recorded duration is a real one. */
  const slow = (ms: number) =>
    vi.mocked(generateText).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(result() as never), ms)),
    );

  it("books how long the call took", async () => {
    slow(30);
    await meteredGenerateText(CALL);
    expect(rows[0].duration_ms as number).toBeGreaterThanOrEqual(25);
    expect(rows[0].duration_ms as number).toBeLessThan(5000);
  });

  it("books the duration of a call that threw", async () => {
    // The most interesting row in the table for anyone asking whether a route's
    // ceiling is set anywhere near reality: a call that ran long and then failed.
    vi.mocked(generateText).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("upstream 503")), 30)),
    );
    await expect(meteredGenerateText(CALL)).rejects.toThrow("upstream 503");
    expect(rows[0]).toMatchObject({ ok: false });
    expect(rows[0].duration_ms as number).toBeGreaterThanOrEqual(25);
  });

  it("never books a duration of null or a negative", async () => {
    // Null is reserved for rows that predate the column. A live call always
    // measured something, and 0 would be a claim rather than an absence.
    await meteredGenerateText(CALL);
    expect(rows[0].duration_ms).not.toBeNull();
    expect(rows[0].duration_ms as number).toBeGreaterThanOrEqual(0);
  });
});

