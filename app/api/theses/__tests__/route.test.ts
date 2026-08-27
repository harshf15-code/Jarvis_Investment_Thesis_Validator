import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn().mockRejectedValue(new Error("not found")),
  getFundamentals: vi.fn().mockResolvedValue({}),
  resolveYahooSymbol: (ticker: string, exchange: string) =>
    exchange === "NSE" ? `${ticker}.NS` : ticker,
}));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { generateText } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "../route";

function buildSupabaseMock(opts: { existingTheses?: unknown[] } = {}) {
  const insertedThesis = { id: "thesis-1", status: "draft" };
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "theses") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: opts.existingTheses ?? [],
                  error: null,
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: insertedThesis, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const RAW_RESPONSE = `## Market View
V

## Mispricing
M

## Catalyst
C

## Time Horizon
T

## Invalidation
I

\`\`\`json
{"mode":"thesis_only","ticker":null,"market_view":"V","mispricing":"M","catalyst":"C","time_horizon":"T","invalidation_condition":"I","conviction_tier":"II","conviction_score":60,"stock_suggestions":[]}
\`\`\``;

describe("POST /api/theses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an empty input_text", async () => {
    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("generates and persists a thesis, no duplicate warning when none exists", async () => {
    vi.mocked(createAdminClient).mockReturnValue(buildSupabaseMock() as never);
    vi.mocked(generateText).mockResolvedValue({ text: RAW_RESPONSE } as never);

    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "I think Indian IT is bottoming" }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.thesis.id).toBe("thesis-1");
    expect(body.duplicateWarning).toBe(null);
  });

  it("surfaces a duplicateWarning when an existing thesis matches the resolved ticker", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      buildSupabaseMock({
        existingTheses: [{ id: "thesis-old", status: "active", created_at: "2026-06-01T00:00:00Z" }],
      }) as never,
    );
    vi.mocked(generateText).mockResolvedValue({
      text: RAW_RESPONSE.replace('"ticker":null', '"ticker":"TCS"'),
    } as never);

    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "TCS looks interesting" }),
    });
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.duplicateWarning?.existingThesisId).toBe("thesis-old");
  });
});
