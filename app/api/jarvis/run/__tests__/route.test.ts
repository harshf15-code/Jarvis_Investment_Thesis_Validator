import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import {
  callsFor,
  createMockSupabase,
  fail,
  ok,
} from "@/app/api/stocks/__tests__/mock-supabase";

/**
 * Mocked-integration test of the route handler, following the same pattern
 * as `app/api/stocks/[id]/__tests__/route.test.ts`: the Supabase admin
 * client is replaced with `createMockSupabase`'s chainable fake, driven by
 * a fixed, ordered list of responses. This is the "mock the Supabase admin
 * client in an integration-style test" branch of Task 8's brief (rather
 * than fully extracting the DB-write sequencing into a pure function): the
 * `alert_criteria` insert needs the real DB-generated
 * `jarvis_analyses.id` from the *previous* insert's result, so the
 * ordering can't be planned ahead of time as a static list independent of
 * a client — see `lib/jarvis-run.ts`'s pure helpers
 * (`computeNextVersion`/`buildJarvisAnalysisInsert`/
 * `buildAlertCriteriaInsert`, unit-tested directly in
 * `lib/__tests__/jarvis-run.test.ts`) for the parts that *are* pure.
 *
 * No real `OPENROUTER_API_KEY` exists in this environment, so `ai`'s
 * `generateText` and `lib/market-data.ts`'s Yahoo calls are mocked too —
 * no live network call is ever attempted.
 */

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
  getHistoricalOHLCV: vi.fn(),
  getFundamentals: vi.fn(),
}));

vi.mock("@/lib/llm/openrouter", () => ({
  jarvisModel: { modelId: "mock-model" },
  JARVIS_MODEL_ID: "anthropic/claude-sonnet-4.5",
}));

const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { getFundamentals, getHistoricalOHLCV, getQuote } from "@/lib/market-data";
import { POST } from "@/app/api/jarvis/run/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const STOCK = {
  id: "stock-1",
  ticker: "AAPL",
  yahoo_symbol: "AAPL",
  exchange: "US",
  type: "watchlist",
  status: "watching",
  consecutive_failure_count: 0,
  stale_since: null,
  last_price: 190.12,
  last_price_at: "2026-08-27T00:00:00.000Z",
  created_at: "2026-08-27T00:00:00.000Z",
  deleted_at: null,
};

const QUOTE = { price: 190.12, asOf: new Date("2026-08-27T00:00:00.000Z") };
const OHLCV = [
  {
    time: "2026-08-26",
    open: 188,
    high: 191,
    low: 187,
    close: 190,
    volume: 1000000,
  },
];
const FUNDAMENTALS = { trailingPE: 28.5 };

const INSERTED_ANALYSIS = {
  id: "analysis-1",
  stock_id: "stock-1",
  version: 1,
  is_latest: true,
  extraction_ok: true,
  thesis_json: { narrative: "..." },
  stress_test_json: { narrative: "..." },
  trade_plan_json: { narrative: "..." },
  exit_json: { riskAwareness: "...", exitDiscipline: "..." },
  raw_llm_response: "raw",
  model_id: "anthropic/claude-sonnet-4.5",
  input_context_json: {},
  created_at: "2026-08-27T00:00:00.000Z",
};

const VALID_JSON_BLOCK = {
  entry_zone: { low: 100, high: 110 },
  stop_loss: 90,
  trim_targets: [{ price: 130, pct_of_position: 0.5 }],
  time_exit_date: "2026-12-31",
  reassessment_date: "2026-09-15",
  earnings_date: null,
  invalidation_condition: "Thesis breaks if X happens",
  catalyst: "Earnings beat",
  verdict: "proceed",
  position_size_note: "Standard size",
};

const RAW_RESPONSE_OK = `## Thesis Structuring
Thesis text.

## Stress Test
Stress test text.

## Trade Plan
Trade plan text.

## Risk Awareness
Risk awareness text.

## Exit Discipline
Exit discipline text.

\`\`\`json
${JSON.stringify(VALID_JSON_BLOCK)}
\`\`\`
`;

const RAW_RESPONSE_NO_JSON = `## Thesis Structuring
Thesis text.

## Stress Test
Stress test text.

## Trade Plan
Trade plan text.

## Risk Awareness
Risk awareness text.

## Exit Discipline
Exit discipline text.
`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQuote).mockResolvedValue(QUOTE);
  vi.mocked(getHistoricalOHLCV).mockResolvedValue(OHLCV);
  vi.mocked(getFundamentals).mockResolvedValue(FUNDAMENTALS);
});

describe("POST /api/jarvis/run", () => {
  it("returns 400 for an invalid body", async () => {
    const response = await POST(jsonRequest({}));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 when the stock doesn't exist (or is soft-deleted)", async () => {
    const { client } = createMockSupabase([ok(null)]);
    vi.mocked(createAdminClient).mockReturnValue(client);

    const response = await POST(jsonRequest({ stockId: "stock-1" }));
    expect(response.status).toBe(404);
  });

  it("returns a clean 502 (not an unhandled rejection) on a market-data network failure", async () => {
    const { client } = createMockSupabase([ok(STOCK)]);
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(getQuote).mockRejectedValue(new Error("ECONNRESET"));

    const response = await POST(jsonRequest({ stockId: "stock-1" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain("ECONNRESET");
  });

  it("returns a clean 502 when the LLM call fails", async () => {
    const { client } = createMockSupabase([
      ok(STOCK), // fetch stock
      ok([]), // manual fundamentals
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);
    generateTextMock.mockRejectedValue(new Error("OpenRouter: no response"));

    const response = await POST(jsonRequest({ stockId: "stock-1" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain("OpenRouter: no response");
  });

  it("extraction.ok = true: writes is_latest bookkeeping before insert, then writes alert_criteria bookkeeping", async () => {
    const { client, calls } = createMockSupabase([
      ok(STOCK), // fetch stock
      ok([]), // manual fundamentals
      ok([{ version: 1 }, { version: 2 }]), // existing versions -> next = 3
      ok(null), // unset previous is_latest
      ok(INSERTED_ANALYSIS), // insert jarvis_analyses
      ok(null), // unset previous is_active
      ok(null), // insert alert_criteria
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);
    generateTextMock.mockResolvedValue({ text: RAW_RESPONSE_OK });

    const response = await POST(jsonRequest({ stockId: "stock-1" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(INSERTED_ANALYSIS);

    // Ordering: is_latest unset happens before the jarvis_analyses insert.
    const jarvisCalls = calls.filter((c) => c.table === "jarvis_analyses");
    const updateIdx = jarvisCalls.findIndex((c) => c.method === "update");
    const insertIdx = jarvisCalls.findIndex((c) => c.method === "insert");
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(updateIdx);

    expect(callsFor(calls, "alert_criteria", "update")).toHaveLength(1);
    expect(callsFor(calls, "alert_criteria", "insert")).toHaveLength(1);

    // The version passed to insert should be current max (2) + 1 = 3.
    const insertArgs = jarvisCalls.find((c) => c.method === "insert")!
      .args[0] as { version: number };
    expect(insertArgs.version).toBe(3);
  });

  it("extraction.ok = false: skips alert_criteria bookkeeping entirely, leaving any previous active row untouched", async () => {
    const { client, calls } = createMockSupabase([
      ok(STOCK), // fetch stock
      ok([]), // manual fundamentals
      ok([]), // existing versions -> next = 1
      ok(null), // unset previous is_latest
      ok({ ...INSERTED_ANALYSIS, extraction_ok: false }), // insert jarvis_analyses
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);
    generateTextMock.mockResolvedValue({ text: RAW_RESPONSE_NO_JSON });

    const response = await POST(jsonRequest({ stockId: "stock-1" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.extraction_ok).toBe(false);

    expect(callsFor(calls, "alert_criteria", "update")).toHaveLength(0);
    expect(callsFor(calls, "alert_criteria", "insert")).toHaveLength(0);

    const jarvisCalls = calls.filter((c) => c.table === "jarvis_analyses");
    const insertArgs = jarvisCalls.find((c) => c.method === "insert")!
      .args[0] as { extraction_ok: boolean };
    expect(insertArgs.extraction_ok).toBe(false);
  });

  it("returns 500 (not a silent partial write) when the jarvis_analyses insert fails", async () => {
    const { client } = createMockSupabase([
      ok(STOCK),
      ok([]),
      ok([]),
      ok(null),
      fail("db is down"),
    ]);
    vi.mocked(createAdminClient).mockReturnValue(client);
    generateTextMock.mockResolvedValue({ text: RAW_RESPONSE_OK });

    const response = await POST(jsonRequest({ stockId: "stock-1" }));
    expect(response.status).toBe(500);
  });
});
