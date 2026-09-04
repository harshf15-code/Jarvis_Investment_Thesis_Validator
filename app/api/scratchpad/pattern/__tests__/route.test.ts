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
vi.mock("@/lib/market-data", () => ({ getSectorProfile: vi.fn() }));

import { generateText } from "ai";
import { currentUser } from "@/lib/auth/user";
import { checkBudget } from "@/lib/llm/budget";
import { getSectorProfile } from "@/lib/market-data";
import { createClient } from "@/lib/supabase/server";
import { POST } from "../route";

const READ = {
  headline: "You buy monopolies with a policy tailwind and wait.",
  signals: [
    {
      theme: "Defence and PSU capex",
      tickers: ["HAL", "ICICIBANK"],
      note: "One supplier, one buyer.",
      also_look_at: "What happens when the order book stops growing?",
    },
  ],
  not_explained: "LIQUIDCASE is not a sector position.",
  grounded_in: ["HAL sector Industrials"],
  generated_at: "2026-09-01",
};

const fenced = (o: unknown) => ({ text: "```json\n" + JSON.stringify(o) + "\n```" });

const HOLDINGS = [
  { id: "pos-1", ticker: "HAL", thesis_id: "th-1", stock_id: "st-1" },
  { id: "pos-2", ticker: "ICICIBANK", thesis_id: "th-2", stock_id: "st-2" },
  { id: "pos-3", ticker: "LIQUIDCASE", thesis_id: "th-3", stock_id: "st-3" },
];

let saved: Record<string, unknown> | null = null;

/** The book being read. Uuid-shaped: the route parses `?portfolio=`. */
const PF1 = "11111111-1111-4111-8111-111111111111";

const BOOK = {
  id: PF1,
  name: "My Portfolio",
  ownership: "owned",
  beneficiary_name: null,
  base_currency: "INR",
  is_default: true,
};

/** Every POST names a book — the route refuses an unscoped one. */
const post = (scope: string = PF1) =>
  new Request(`http://test/api/scratchpad/pattern?portfolio=${scope}`, { method: "POST" });

function buildMock(
  opts: {
    positions?: typeof HOLDINGS;
    notes?: { body: string }[];
    /** Thesis input_text by thesis_id, for the same-name collapse test. */
    thesisText?: Record<string, string | null>;
    /** `null` stands for "not this trader's book", which must 404. */
    portfolio?: Record<string, unknown> | null;
  } = {},
) {
  const positions = opts.positions ?? HOLDINGS;
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
              data: positions.map((p) => ({
                id: p.stock_id,
                ticker: p.ticker,
                yahoo_symbol: `${p.ticker}.NS`,
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
                input_text:
                  opts.thesisText && p.thesis_id in opts.thesisText
                    ? opts.thesisText[p.thesis_id]
                    : `Why I own ${p.ticker}.`,
                source: "imported",
                market_view: null,
                mispricing: null,
                catalyst: null,
                conviction_tier: null,
              })),
              error: null,
            }),
          }),
        };
      }
      if (table === "scratchpad_notes") {
        return {
          select: () => {
            const chain: Record<string, unknown> = {
              eq: () => chain,
              is: () => chain,
              order: () => chain,
              limit: async () => ({ data: opts.notes ?? [], error: null }),
            };
            return chain;
          },
        };
      }
      if (table === "portfolio_profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { objective: "Compound." }, error: null }) }),
          }),
        };
      }
      if (table === "portfolio_pattern_reads") {
        return {
          insert: (row: Record<string, unknown>) => {
            saved = row;
            return {
              select: () => ({ single: async () => ({ data: { id: "read-1", ...row }, error: null }) }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ledger.length = 0;
  saved = null;
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(checkBudget).mockResolvedValue({ ok: true } as never);
  vi.mocked(createClient).mockResolvedValue(buildMock() as never);
  vi.mocked(getSectorProfile).mockResolvedValue({
    sector: "Industrials",
    industry: "Aerospace & Defense",
  } as never);
  vi.mocked(generateText).mockResolvedValue(fenced(READ) as never);
});

describe("POST /api/scratchpad/pattern", () => {
  it("reads the book once and saves what it reviewed alongside the read", async () => {
    const res = await POST(post());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(body.read.document.headline).toBe(READ.headline);
    // Without the snapshot an old read silently presents as current once the
    // book has moved on.
    const snapshot = saved?.holdings_snapshot as { holdings: { ticker: string }[] };
    expect(snapshot.holdings.map((h) => h.ticker)).toEqual(["HAL", "ICICIBANK", "LIQUIDCASE"]);
  });

  it("labels the call in the spend ledger", async () => {
    await POST(post());
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ feature: "portfolio_pattern_read" });
  });

  it("grounds the prompt in fetched sectors, the objective and the trader's notes", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({ notes: [{ body: "Look at power transmission." }] }) as never,
    );
    await POST(post());

    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Sector: Industrials — Aerospace & Defense");
    expect(prompt).toContain("Compound.");
    expect(prompt).toContain("- Look at power transmission.");
  });

  it("refuses when not signed in", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses, and spends nothing, when the trader is over budget", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false,
      window: "daily",
      message: "Daily cap reached.",
    } as never);
    const res = await POST(post());
    expect(res.status).toBe(429);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("answers 503, not 429, when spend is unknown rather than exhausted", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      ok: false,
      window: "unavailable",
      message: "Can't tell.",
    } as never);
    const res = await POST(post());
    expect(res.status).toBe(503);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("says there is nothing to read yet rather than spending a call on two holdings", async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildMock({ positions: HOLDINGS.slice(0, 2) }) as never,
    );
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
    expect(saved).toBeNull();
  });

  it("counts two positions in the same name as one holding", async () => {
    // Three positions, two tickers — a pattern across one repeated name is not
    // a pattern.
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [
          HOLDINGS[0],
          HOLDINGS[1],
          { id: "pos-4", ticker: "HAL", thesis_id: "th-4", stock_id: "st-4" },
        ],
      }) as never,
    );
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("keeps the read when one holding's classification fails", async () => {
    vi.mocked(getSectorProfile)
      .mockResolvedValueOnce({ sector: "Industrials", industry: null } as never)
      .mockRejectedValueOnce(new Error("Yahoo said no"))
      .mockResolvedValueOnce({ sector: null, industry: null } as never);

    const res = await POST(post());
    expect(res.status).toBe(201);

    // The holding loses its sector and is told to the model as unclassified —
    // it does not cost the trader the whole read.
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("not classified by the data source");
  });

  it("drops a signal naming a ticker the trader does not hold", async () => {
    vi.mocked(generateText).mockResolvedValue(
      fenced({
        ...READ,
        signals: [
          READ.signals[0],
          { theme: "Invented", tickers: ["BEL"], note: "x", also_look_at: null },
        ],
      }) as never,
    );
    const res = await POST(post());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.read.document.signals).toHaveLength(1);
    expect(body.read.document.signals[0].theme).toBe("Defence and PSU capex");
  });

  it("saves nothing when the answer cannot be validated", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "I couldn't find a pattern." } as never);
    const res = await POST(post());

    expect(res.status).toBe(502);
    // A row that fails its own schema on the way back in would render as
    // "written in an older format" forever.
    expect(saved).toBeNull();
  });

  it("saves nothing when the model call itself fails", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("timed out"));
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect(saved).toBeNull();
  });

  it("refuses to let an unclassified holding be placed in a signal", async () => {
    // The guarantee this feature promises is deterministic, so it cannot rest
    // on the model obeying the prompt. LIQUIDCASE is held, so a held-only check
    // would admit it; it has no sector, so it is not eligible.
    vi.mocked(getSectorProfile).mockImplementation((async (symbol: string) =>
      symbol.startsWith("LIQUIDCASE")
        ? { sector: null, industry: null }
        : { sector: "Industrials", industry: null }) as never);
    vi.mocked(generateText).mockResolvedValue(
      fenced({
        ...READ,
        signals: [{ ...READ.signals[0], tickers: ["HAL", "ICICIBANK", "LIQUIDCASE"] }],
      }) as never,
    );

    const res = await POST(post());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.read.document.signals[0].tickers).toEqual(["HAL", "ICICIBANK"]);
  });

  it("drops a signal the model padded down to one holding", async () => {
    vi.mocked(generateText).mockResolvedValue(
      fenced({ ...READ, signals: [{ ...READ.signals[0], tickers: ["HAL"] }] }) as never,
    );
    const res = await POST(post());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.read.document.signals).toHaveLength(0);
  });

  it("keeps the stated reason when the same name is held twice", async () => {
    // Collapsing same-name positions is right for a pattern, but only one
    // rationale reaches the model. Keeping whichever row arrived first threw
    // away the only reason the trader had written.
    vi.mocked(createClient).mockResolvedValue(
      buildMock({
        positions: [
          { id: "pos-0", ticker: "HAL", thesis_id: "th-0", stock_id: "st-0" },
          ...HOLDINGS,
        ],
        thesisText: { "th-0": null, "th-1": "The order book is the whole thesis." },
      }) as never,
    );

    await POST(post());
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("The order book is the whole thesis.");
  });
});
