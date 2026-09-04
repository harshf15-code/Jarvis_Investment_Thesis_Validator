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
vi.mock("@/lib/market-data", () => ({ getQuote: vi.fn(), getFundamentals: vi.fn() }));

import { generateText } from "ai";
import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { getFundamentals, getQuote } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

const MEMBER_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

const OPINION = {
  headline: "Too concentrated.",
  structural_read: { concentration: "c", diversification: "d", sizing: "s", cash: "x" },
  holding_calls: [{ ticker: "INFY", call: "TRIM", reason: "Half the book." }],
  biggest_risk: "One name decides the year.",
};

const SYNTHESIS = {
  summary: "They broadly agree.",
  where_they_agree: ["All three flag INFY."],
  where_they_diverge: [],
  loudest_calls: ["INFY"],
};

const fenced = (o: unknown) => ({ text: "```json\n" + JSON.stringify(o) + "\n```" });

let saved: Record<string, unknown> | null = null;

function buildMock(
  opts: {
    positions?: number;
    members?: number;
    objective?: string | null;
    exits?: { position_id: string; quantity: number }[];
    tickers?: string[];
    currencies?: string[];
    /** `null` stands for "not this trader's book", which must 404. */
    portfolio?: Record<string, unknown> | null;
  } = {},
) {
  const count = opts.positions ?? 2;
  const positions = Array.from({ length: count }, (_, i) => ({
    id: `pos-${i}`,
    ticker: opts.tickers?.[i] ?? (i === 0 ? "INFY" : `T${i}`),
    thesis_id: `th-${i}`,
    trade_plan_id: `tp-${i}`,
    stock_id: `st-${i}`,
  }));
  const memberCount = opts.members ?? 3;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.portfolio === undefined ? BOOK : opts.portfolio,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "positions") {
        // Chainable: the read now filters by book as well as status.
        const chain: Record<string, unknown> = {
          eq: () => chain,
          in: async () => ({ data: positions, error: null }),
        };
        return { select: () => chain };
      }
      if (table === "stocks") {
        return {
          select: () => ({
            in: async () => ({
              data: positions.map((p, i) => ({
                id: p.stock_id,
                ticker: p.ticker,
                yahoo_symbol: `${p.ticker}.NS`,
                currency: opts.currencies?.[i] ?? (i === 0 ? "INR" : "USD"),
                last_price: 1000,
              })),
              error: null,
            }),
          }),
        };
      }
      if (table === "theses") {
        return {
          select: () => ({
            in: async () => ({
              data: positions.map((p) => ({
                id: p.thesis_id,
                input_text: `Imported holding — ${p.ticker}. No stated reason recorded at import.`,
                source: "imported",
              })),
              error: null,
            }),
          }),
        };
      }
      if (table === "trade_plans") {
        return {
          select: () => ({
            in: async () => ({
              data: positions.map((p) => ({
                id: p.trade_plan_id,
                stop_loss: null,
                target_1: null,
                target_2: null,
                time_exit_date: null,
                time_exit_condition: null,
              })),
              error: null,
            }),
          }),
        };
      }
      if (table === "entries") {
        return {
          select: () => ({
            in: async () => ({
              data: positions.map((p) => ({ position_id: p.id, quantity: 10, price: 1400 })),
              error: null,
            }),
          }),
        };
      }
      if (table === "exits") {
        return {
          select: () => ({
            in: async () => ({ data: opts.exits ?? [], error: null }),
          }),
        };
      }
      if (table === "portfolio_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.objective === undefined ? null : { objective: opts.objective },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "council_members") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: MEMBER_IDS.slice(0, memberCount).map((id, i) => ({
                  id,
                  name: `Member ${i}`,
                  philosophy: "x".repeat(50),
                  source: "builtin",
                })),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "portfolio_council_reports") {
        return {
          insert: (row: Record<string, unknown>) => {
            saved = row;
            return {
              select: () => ({ single: async () => ({ data: { id: "rep-1", ...row }, error: null }) }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

/** The book under consult. Uuid-shaped: the route parses `?portfolio=`. */
const PF1 = "11111111-1111-4111-8111-111111111111";

const BOOK = {
  id: PF1,
  name: "My Portfolio",
  ownership: "owned",
  beneficiary_name: null,
  base_currency: "INR",
  is_default: true,
};

const post = (body: Record<string, unknown> = {}, scope: string = PF1) =>
  new Request(`http://test/api/portfolio/council?portfolio=${scope}`, {
    method: "POST",
    body: JSON.stringify({ member_ids: MEMBER_IDS, ...body }),
  });

describe("POST /api/portfolio/council", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved = null;
    ledger.length = 0;
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
    vi.mocked(getQuote).mockResolvedValue({
      price: 1200, asOf: new Date(), name: "A Company", currency: "INR",
    } as never);
    vi.mocked(getFundamentals).mockResolvedValue({ trailingPE: 20 } as never);
    vi.mocked(generateText).mockImplementation(async (args) =>
      ((args.system as string).includes("summarising") ? fenced(SYNTHESIS) : fenced(OPINION)) as never,
    );
  });

  it("costs N+1 model calls, like the thesis council", async () => {
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(generateText).toHaveBeenCalledTimes(4);
  });

  it("refreshes every holding rather than reading a cached price", async () => {
    // "What would my advisor say about this book" is a question about today.
    await POST(post());
    expect(getQuote).toHaveBeenCalledTimes(2);
    expect(getFundamentals).toHaveBeenCalledTimes(2);
  });

  it("refuses a book with nothing to judge", async () => {
    vi.mocked(createClient).mockResolvedValue(buildMock({ positions: 1 }) as never);
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 2 open positions/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses a panel below the minimum", async () => {
    expect((await POST(post({ member_ids: MEMBER_IDS.slice(0, 2) }))).status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses the same member twice", async () => {
    const dupes = [MEMBER_IDS[0], MEMBER_IDS[0], MEMBER_IDS[1]];
    expect((await POST(post({ member_ids: dupes }))).status).toBe(400);
  });

  it("still renders the panel when one member fails", async () => {
    let call = 0;
    vi.mocked(generateText).mockImplementation(async (args) => {
      if ((args.system as string).includes("summarising")) return fenced(SYNTHESIS) as never;
      call += 1;
      if (call === 2) throw new Error("timed out");
      return fenced(OPINION) as never;
    });

    const res = await POST(post());
    expect(res.status).toBe(201);
    const doc = (saved!.document as { opinions: { opinion: unknown; error: string | null }[] });
    expect(doc.opinions).toHaveLength(3);
    expect(doc.opinions.filter((o) => o.opinion !== null)).toHaveLength(2);
    // A failed member gets a card carrying the reason, never a blank one.
    expect(doc.opinions.find((o) => o.opinion === null)?.error).toMatch(/timed out/);
  });

  it("502s and saves nothing when every member fails", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("all down"));
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect(saved).toBeNull();
  });

  it("skips synthesis when only one member answered", async () => {
    let call = 0;
    vi.mocked(generateText).mockImplementation(async () => {
      call += 1;
      if (call > 1) throw new Error("down");
      return fenced(OPINION) as never;
    });
    await POST(post());
    // Three attempts, no fourth: restating one card is spend without information.
    expect(generateText).toHaveBeenCalledTimes(3);
    expect((saved!.document as { synthesis: unknown }).synthesis).toBeNull();
  });

  it("drops a call naming a ticker the trader does not hold", async () => {
    vi.mocked(generateText).mockImplementation(async (args) =>
      ((args.system as string).includes("summarising")
        ? fenced(SYNTHESIS)
        : fenced({
            ...OPINION,
            holding_calls: [
              { ticker: "INFY", call: "TRIM", reason: "r" },
              { ticker: "NVDA", call: "ADD", reason: "invented" },
            ],
          })) as never,
    );
    await POST(post());
    const doc = saved!.document as { opinions: { opinion: { holding_calls: { ticker: string }[] } | null }[] };
    for (const o of doc.opinions) {
      expect(o.opinion?.holding_calls.map((c) => c.ticker)).toEqual(["INFY"]);
    }
  });

  it("reviews the quantity still held, not the quantity ever bought", async () => {
    // A partial exit overstates weight, market value and the sizing every
    // member is asked to judge if the exits are not subtracted.
    vi.mocked(createClient).mockResolvedValue(
      buildMock({ exits: [{ position_id: "pos-0", quantity: 6 }] }) as never,
    );
    await POST(post());
    const snap = saved!.holdings_snapshot as { books: { holdings: { ticker: string; quantity: number }[] }[] };
    const infy = snap.books.flatMap((b) => b.holdings).find((h) => h.ticker === "INFY");
    expect(infy?.quantity).toBe(4);
  });

  it("does not pass a cached price off as freshly fetched", async () => {
    // The consult's whole premise is that every holding was re-priced just
    // now. Substituting `stocks.last_price` would stamp a stale quote with a
    // fresh `as_of` and let it carry a weight as though it were live.
    vi.mocked(getQuote).mockRejectedValue(new Error("provider down"));
    await POST(post());
    const snap = saved!.holdings_snapshot as { books: { holdings: { current_price: number | null; weight_pct: number | null }[] }[] };
    const all = snap.books.flatMap((b) => b.holdings);
    expect(all.every((h) => h.current_price === null)).toBe(true);
    expect(all.every((h) => h.weight_pct === null)).toBe(true);
  });

  it("collapses two positions in the same listing into one holding", async () => {
    vi.mocked(createClient).mockResolvedValue(
      // Same listing means same ticker AND same currency — the NSE line and
      // the NYSE ADR are different instruments and stay apart.
      buildMock({
        positions: 3,
        tickers: ["INFY", "INFY", "TCS"],
        currencies: ["INR", "INR", "INR"],
      }) as never,
    );
    await POST(post());
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    // One row, not two half-weighted ones.
    expect(prompt.match(/- INFY/g)).toHaveLength(1);
  });

  it("500s rather than telling the panel a failed read means no rationale", async () => {
    const mock = buildMock();
    const realFrom = mock.from;
    mock.from = vi.fn().mockImplementation((table: string) => {
      if (table === "theses") {
        return { select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) };
      }
      return realFrom(table);
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const res = await POST(post());
    expect(res.status).toBe(500);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("says the synthesis failed, rather than claiming too few answered", async () => {
    vi.mocked(generateText).mockImplementation(async (args) => {
      if ((args.system as string).includes("summarising")) throw new Error("synthesis down");
      return fenced(OPINION) as never;
    });
    await POST(post());
    const doc = saved!.document as { synthesis: unknown; synthesis_skipped: string };
    expect(doc.synthesis).toBeNull();
    expect(doc.synthesis_skipped).toBe("failed");
  });

  it("records what it reviewed and at what prices", async () => {
    // Without this a report silently reads as current after the book moves on.
    await POST(post());
    const snap = saved!.holdings_snapshot as {
      as_of: string;
      books: { currency: string; holdings: { ticker: string; current_price: number }[] }[];
    };
    expect(snap.as_of).toBeTruthy();
    expect(snap.books.map((b) => b.currency).sort()).toEqual(["INR", "USD"]);
    expect(snap.books.flatMap((b) => b.holdings).every((h) => h.current_price === 1200)).toBe(true);
  });

  it("does not feed the import placeholder to a persona as a stated reason", async () => {
    await POST(post());
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("No stated reason recorded at import");
  });

  it("tells the panel that cross-currency concentration is off limits", async () => {
    // This book is INR + USD and no exchange rate exists.
    await POST(post());
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("NO EXCHANGE RATE HAS BEEN APPLIED");
  });

  it("books its spend against the portfolio features, not the thesis ones", async () => {
    // Otherwise "what did the Council cost me" would silently fold a portfolio
    // consult into the per-thesis figure, and the Settings breakdown would be
    // wrong in a way nobody would notice.
    await POST(post());
    const features = ledger.map((row) => row.feature);
    expect(features.filter((f) => f === "portfolio_council_opinion")).toHaveLength(3);
    expect(features.filter((f) => f === "portfolio_council_synthesis")).toHaveLength(1);
    expect(features).not.toContain("council_opinion");
    // A portfolio consult has no thesis to attribute to.
    expect(ledger.every((row) => row.thesis_id === null)).toBe(true);
  });
});

describe("spend guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(createClient).mockResolvedValue(buildMock() as never);
  });

  it("401s with no session", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    expect((await POST(post())).status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("429s when over budget, before doing any work", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false, window: "daily", message: "You've used $1.00 of your $1.00 daily analysis budget.",
    } as never);
    const res = await POST(post());
    expect(res.status).toBe(429);
    expect(generateText).not.toHaveBeenCalled();
    // Not even the market-data refresh, which is the expensive half.
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("503s when the budget cannot be read", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false, window: "unavailable", message: "Couldn't check your analysis budget just now — try again in a moment.",
    } as never);
    expect((await POST(post())).status).toBe(503);
    expect(generateText).not.toHaveBeenCalled();
  });
});
