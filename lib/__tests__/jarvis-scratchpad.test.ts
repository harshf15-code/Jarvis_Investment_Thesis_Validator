import { describe, expect, it } from "vitest";

import {
  PatternReadSchema,
  buildPatternReadUserContext,
  normalizePatternRead,
  parsePatternRead,
  unplacedTickers,
  type PatternHolding,
  type PatternRead,
} from "@/lib/jarvis-scratchpad";

const READ: PatternRead = {
  headline: "You buy monopolies with a policy tailwind and wait.",
  signals: [
    {
      theme: "Defence and PSU capex",
      tickers: ["HAL"],
      note: "One supplier, one buyer, a decade of orders.",
      also_look_at: "Do you have a view on what happens when the order book stops growing?",
    },
    {
      theme: "Lenders",
      tickers: ["ICICIBANK"],
      note: "A franchise bet, not a rate bet.",
      also_look_at: null,
    },
  ],
  not_explained: "LIQUIDCASE is not a sector position.",
  grounded_in: ["HAL sector Industrials", "ICICIBANK sector Financial Services"],
  generated_at: "2026-09-01",
};

const fenced = (o: unknown) => "Here you go.\n\n```json\n" + JSON.stringify(o) + "\n```";

describe("PatternReadSchema", () => {
  it("costs a thin field, not the whole read", () => {
    const parsed = PatternReadSchema.safeParse({
      headline: 42,
      signals: "not an array",
      not_explained: undefined,
      grounded_in: null,
      generated_at: "2026-09-01",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      headline: null,
      signals: [],
      not_explained: null,
      grounded_in: [],
    });
  });

  it("keeps a signal whose optional halves are missing", () => {
    const parsed = PatternReadSchema.safeParse({
      headline: "x",
      signals: [{ theme: "Lenders", tickers: ["ICICIBANK"] }],
      not_explained: null,
      grounded_in: [],
      generated_at: "2026-09-01",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.signals[0]).toMatchObject({
      theme: "Lenders",
      note: null,
      also_look_at: null,
    });
  });
});

describe("parsePatternRead", () => {
  it("reads the fenced block out of surrounding prose", () => {
    const result = parsePatternRead(fenced(READ));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.signals).toHaveLength(2);
  });

  it("fails rather than guessing when there is no fenced block", () => {
    const result = parsePatternRead("I could not find a pattern, sorry.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No valid/);
  });

  it("fails when the block is not the shape promised", () => {
    const result = parsePatternRead("```json\n{\"headline\":\"x\"}\n```");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/schema validation/);
  });
});

describe("normalizePatternRead", () => {
  it("drops a ticker the trader does not hold", () => {
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: ["HAL", "BEL"] }] },
      ["HAL", "ICICIBANK"],
    );
    expect(read.signals[0].tickers).toEqual(["HAL"]);
  });

  it("drops a signal left with no holdings at all", () => {
    // A theme with nothing under it is a claim about a portfolio that does not
    // exist — worse than saying nothing, because it reads as grounded.
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: ["BEL", "BDL"] }] },
      ["HAL"],
    );
    expect(read.signals).toHaveLength(0);
  });

  it("matches on trimmed, upper-cased tickers and de-duplicates", () => {
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: [" hal ", "HAL"] }] },
      ["hal"],
    );
    expect(read.signals[0].tickers).toEqual(["HAL"]);
  });

  it("leaves the rest of the read alone", () => {
    const read = normalizePatternRead(READ, ["HAL", "ICICIBANK"]);
    expect(read.headline).toBe(READ.headline);
    expect(read.grounded_in).toEqual(READ.grounded_in);
  });
});

describe("unplacedTickers", () => {
  it("names a holding no signal claimed", () => {
    // The honesty guarantee, computed rather than asked for: a model that has
    // just told a tidy story is the last thing to ask which holdings spoil it.
    expect(unplacedTickers(READ, ["HAL", "ICICIBANK", "LIQUIDCASE"])).toEqual(["LIQUIDCASE"]);
  });

  it("returns nothing when every holding was placed", () => {
    expect(unplacedTickers(READ, ["HAL", "ICICIBANK"])).toEqual([]);
  });

  it("counts a holding as unplaced when its only signal was dropped as ungrounded", () => {
    const normalized = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], theme: "Defence", tickers: ["BEL"] }] },
      ["HAL"],
    );
    expect(unplacedTickers(normalized, ["HAL"])).toEqual(["HAL"]);
  });

  it("returns every holding when the read found no pattern at all", () => {
    expect(unplacedTickers({ ...READ, signals: [] }, ["HAL", "VBL"])).toEqual(["HAL", "VBL"]);
  });
});

const holding = (over: Partial<PatternHolding> = {}): PatternHolding => ({
  ticker: "HAL",
  companyName: "Hindustan Aeronautics",
  source: "imported",
  sector: "Industrials",
  industry: "Aerospace & Defense",
  rationale: "Defence order book and the capex cycle.",
  marketView: null,
  mispricing: null,
  catalyst: null,
  convictionTier: null,
  ...over,
});

describe("buildPatternReadUserContext", () => {
  it("passes the fetched sector through as fact", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding()],
      objective: null,
      notes: [],
      today: "2026-09-01",
    });
    expect(prompt).toContain("Sector: Industrials — Aerospace & Defense");
    expect(prompt).toContain("Defence order book and the capex cycle.");
  });

  it("tells the model not to supply a sector it was not given", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding({ ticker: "LIQUIDCASE", sector: null, industry: null })],
      objective: null,
      notes: [],
      today: "2026-09-01",
    });
    expect(prompt).toContain("not classified by the data source. Do not supply one.");
  });

  it("names the only tickers a signal may use", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding(), holding({ ticker: "ICICIBANK" })],
      objective: null,
      notes: [],
      today: "2026-09-01",
    });
    expect(prompt).toContain('Valid tickers for "signals": HAL, ICICIBANK.');
  });

  it("says plainly when no objective has been stated rather than omitting the section", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding()],
      objective: null,
      notes: [],
      today: "2026-09-01",
    });
    expect(prompt).toContain("They have not stated an objective.");
  });

  it("includes the trader's notes, framed as half-formed", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding()],
      objective: "Compounding, ten years out.",
      notes: ["Look at power transmission."],
      today: "2026-09-01",
    });
    expect(prompt).toContain("Compounding, ten years out.");
    expect(prompt).toContain("- Look at power transmission.");
    expect(prompt).toContain("do not treat a note as a position");
  });

  it("omits the notes section entirely when there are none", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding()],
      objective: null,
      notes: [],
      today: "2026-09-01",
    });
    expect(prompt).not.toContain("SCRATCHPAD NOTES");
  });
});
