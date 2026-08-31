import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/market-data", () => ({
  getQuote: vi.fn(),
  getFundamentals: vi.fn().mockResolvedValue({}),
  resolveYahooSymbol: (ticker: string, exchange: string) =>
    exchange === "NSE" ? `${ticker}.NS` : ticker,
}));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/llm/budget", () => ({ checkBudget: vi.fn() }));
// `stocks` is a shared cache that `authenticated` may only read (0014), so the
// route writes it through the service-role client.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: "stock-1" }, error: null }) }),
      }),
    }),
  }),
}));

import { generateText } from "ai";
import { getQuote } from "@/lib/market-data";
import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

/** Every request now has to name a market; India unless a test says otherwise. */
function post(body: Record<string, unknown>) {
  return new Request("http://test/api/theses", {
    method: "POST",
    body: JSON.stringify({ markets: ["IN"], ...body }),
  }) as never;
}

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
      if (table === "stocks") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
    // Nothing resolves by default, so a ticker only survives when a test
    // explicitly makes the quote succeed.
    vi.mocked(getQuote).mockRejectedValue(new Error("not found"));
  });

  it("rejects an empty input_text", async () => {
    const res = await POST(post({ input_text: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects a request with no market", async () => {
    const req = new Request("http://test/api/theses", {
      method: "POST",
      body: JSON.stringify({ input_text: "Indian IT is bottoming" }),
    });
    expect((await POST(req as never)).status).toBe(400);
  });

  it("rejects a market that is not live yet", async () => {
    const res = await POST(post({ input_text: "China robotics", markets: ["CN"] }));
    expect(res.status).toBe(400);
  });

  it("generates and persists a thesis, no duplicate warning when none exists", async () => {
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock() as never);
    vi.mocked(generateText).mockResolvedValue({ text: RAW_RESPONSE } as never);

    const res = await POST(post({ input_text: "I think Indian IT is bottoming" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.thesis.id).toBe("thesis-1");
    expect(body.duplicateWarning).toBe(null);
  });

  it("surfaces a duplicateWarning when an existing thesis matches the resolved ticker", async () => {
    const supabase = buildSupabaseMock({
      existingTheses: [{ id: "thesis-old", status: "active", created_at: "2026-06-01T00:00:00Z" }],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(getQuote).mockResolvedValue({ price: 100, asOf: new Date(), name: null, currency: "INR" } as never);
    vi.mocked(generateText).mockResolvedValue({
      text: RAW_RESPONSE
        .replace('"mode":"thesis_only"', '"mode":"stock_only"')
        .replace('"ticker":null', '"ticker":"TCS"'),
    } as never);

    const res = await POST(post({ input_text: "TCS looks interesting", names_stocks: true }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.duplicateWarning?.existingThesisId).toBe("thesis-old");
  });

  /**
   * The robotics regression. A macro thesis came back as `thesis_only` while
   * also naming ZBRA — a ticker absent from the trader's text. That field is
   * what makes the memorandum route compare "this stock vs its peers" and seed
   * the name so it can never be dropped, so an invented ticker became the
   * premise of the analysis. It must not reach the row.
   */
  it("never persists a ticker the model invented for a thesis_only run", async () => {
    const supabase = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(getQuote).mockResolvedValue({ price: 356, asOf: new Date(), name: null, currency: "USD" } as never);
    vi.mocked(generateText).mockResolvedValue({
      text: RAW_RESPONSE.replace('"ticker":null', '"ticker":"ZBRA"'),
    } as never);

    const res = await POST(
      post({ input_text: "which companies benefit from robot actuators?", markets: ["US"] }),
    );
    expect(res.status).toBe(201);

    const insert = supabase.from.mock.results
      .map((x) => x.value)
      .find((v) => v?.insert?.mock?.calls?.length)?.insert.mock.calls[0][0];
    expect(insert.ticker).toBe(null);
    expect(insert.markets).toEqual(["US"]);
  });

  it("refuses a listing quoted in the wrong currency for the chosen market", async () => {
    // A US probe is a BARE ticker, so Yahoo may answer with a foreign listing.
    // Accepting it would seed a US thesis — and later a memorandum candidate
    // compared against its peers — from a market the trader never asked about,
    // priced in money the grid does not label.
    const supabase = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(getQuote).mockResolvedValue({
      price: 90, asOf: new Date(), name: "Nestlé S.A.", currency: "CHF",
    } as never);
    vi.mocked(generateText).mockResolvedValue({
      text: RAW_RESPONSE
        .replace('"mode":"thesis_only"', '"mode":"stock_only"')
        .replace('"ticker":null', '"ticker":"NESN"'),
    } as never);

    const res = await POST(post({ input_text: "NESN looks cheap", names_stocks: true, markets: ["US"] }));
    expect(res.status).toBe(201);

    const insert = supabase.from.mock.results
      .map((x) => x.value)
      .find((v) => v?.insert?.mock?.calls?.length)?.insert.mock.calls[0][0];
    // Unresolved, so no ticker is persisted and no stock row is created.
    expect(insert.ticker).toBe(null);
  });

  it("ignores a model ticker when the trader did not tick 'naming stocks'", async () => {
    const supabase = buildSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(getQuote).mockResolvedValue({ price: 100, asOf: new Date(), name: null, currency: "INR" } as never);
    vi.mocked(generateText).mockResolvedValue({
      text: RAW_RESPONSE
        .replace('"mode":"thesis_only"', '"mode":"stock_only"')
        .replace('"ticker":null', '"ticker":"TCS"'),
    } as never);

    const res = await POST(post({ input_text: "Indian IT", names_stocks: false }));
    expect(res.status).toBe(201);

    const insert = supabase.from.mock.results
      .map((x) => x.value)
      .find((v) => v?.insert?.mock?.calls?.length)?.insert.mock.calls[0][0];
    expect(insert.ticker).toBe(null);
  });
});

describe("spend guard", () => {
  // This block is a sibling of the suite above, so it needs its own reset —
  // that suite's beforeEach does not reach here.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
    vi.mocked(createClient).mockResolvedValue(buildSupabaseMock() as never);
  });

  it("refuses with 429 and spends nothing when over budget", async () => {
    // The point of the pre-flight check: an account that is over budget must
    // cost zero, not "one more request's worth".
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false,
      window: "daily",
      message: "You've used $1.00 of your $1.00 daily analysis budget.",
    } as never);
    const res = await POST(post({ input_text: "banks look cheap" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/daily analysis budget/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("503s and spends nothing when the budget cannot be read", async () => {
    // Fails closed. An RPC broken by a permission change or an unapplied
    // migration must not silently remove the cap.
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false,
      window: "unavailable",
      message: "Couldn't check your analysis budget just now — try again in a moment.",
    } as never);
    const res = await POST(post({ input_text: "banks look cheap" }));
    expect(res.status).toBe(503);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("401s a request with no session", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await POST(post({ input_text: "banks look cheap" }));
    expect(res.status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });
});
