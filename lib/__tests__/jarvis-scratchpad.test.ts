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

/** A signal is a cluster of two or more — the prompt has always said so. */
const READ: PatternRead = {
  headline: "You buy monopolies with a policy tailwind and wait.",
  signals: [
    {
      theme: "Defence and PSU capex",
      tickers: ["HAL", "BEL"],
      note: "One supplier, one buyer, a decade of orders.",
      also_look_at: "Do you have a view on what happens when the order book stops growing?",
    },
    {
      theme: "Lenders",
      tickers: ["ICICIBANK", "HDFCBANK"],
      note: "A franchise bet, not a rate bet.",
      also_look_at: null,
    },
  ],
  not_explained: "LIQUIDCASE is not a sector position.",
  grounded_in: ["HAL sector Industrials", "ICICIBANK sector Financial Services"],
  generated_at: "2026-09-01",
};

const BOOK = ["HAL", "BEL", "ICICIBANK", "HDFCBANK"];

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
  it("drops a ticker outside the eligible set", () => {
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: ["HAL", "BEL", "BDL"] }] },
      BOOK,
    );
    expect(read.signals[0].tickers).toEqual(["HAL", "BEL"]);
  });

  it("drops a signal left with no holdings at all", () => {
    // A theme with nothing under it is a claim about a portfolio that does not
    // exist — worse than saying nothing, because it reads as grounded.
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: ["BDL", "MAZDOCK"] }] },
      BOOK,
    );
    expect(read.signals).toHaveLength(0);
  });

  it("drops a signal down to a single holding", () => {
    // The prompt defines a signal as a cluster of two or more. Unenforced, a
    // model can dress every individual holding up as its own "pattern" — which
    // presents one position as a portfolio-level finding AND quietly marks it
    // explained.
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: ["HAL"] }] },
      BOOK,
    );
    expect(read.signals).toHaveLength(0);
  });

  it("drops a signal that becomes a singleton once ungrounded tickers go", () => {
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: ["HAL", "BDL"] }] },
      BOOK,
    );
    expect(read.signals).toHaveLength(0);
  });

  it("refuses a held holding the data source could not classify", () => {
    // The load-bearing one. LIQUIDCASE is held, so a held-only check would let
    // it through; it is not eligible because Yahoo has no sector for it. The
    // prompt tells the model to leave it out — this is what makes that true
    // when the model does not.
    const read = normalizePatternRead(
      {
        ...READ,
        signals: [{ ...READ.signals[0], tickers: ["HAL", "BEL", "LIQUIDCASE"] }],
      },
      BOOK,
    );
    expect(read.signals[0].tickers).toEqual(["HAL", "BEL"]);
  });

  it("matches on trimmed, upper-cased tickers and de-duplicates", () => {
    const read = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], tickers: [" hal ", "HAL", "bel"] }] },
      BOOK,
    );
    expect(read.signals[0].tickers).toEqual(["HAL", "BEL"]);
  });

  it("leaves the rest of the read alone", () => {
    const read = normalizePatternRead(READ, BOOK);
    expect(read.headline).toBe(READ.headline);
    expect(read.grounded_in).toEqual(READ.grounded_in);
  });
});

describe("unplacedTickers", () => {
  it("names a holding no signal claimed", () => {
    // The honesty guarantee, computed rather than asked for: a model that has
    // just told a tidy story is the last thing to ask which holdings spoil it.
    expect(unplacedTickers(READ, [...BOOK, "LIQUIDCASE"])).toEqual(["LIQUIDCASE"]);
  });

  it("returns nothing when every holding was placed", () => {
    expect(unplacedTickers(READ, BOOK)).toEqual([]);
  });

  it("reports an unclassified holding that normalization refused to place", () => {
    // End to end, and the reason the two functions take different sets: the
    // signal may only name eligible tickers, the unplaced list is computed
    // against everything actually held.
    const normalized = normalizePatternRead(
      {
        ...READ,
        signals: [{ ...READ.signals[0], tickers: ["HAL", "BEL", "LIQUIDCASE"] }],
      },
      BOOK,
    );
    // Order follows the book as given, not an alphabetical sort.
    expect(unplacedTickers(normalized, [...BOOK, "LIQUIDCASE"])).toEqual([
      "ICICIBANK",
      "HDFCBANK",
      "LIQUIDCASE",
    ]);
  });

  it("counts a holding as unplaced when its only signal was dropped", () => {
    const normalized = normalizePatternRead(
      { ...READ, signals: [{ ...READ.signals[0], theme: "Defence", tickers: ["HAL"] }] },
      BOOK,
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
  assetClass: "equity",
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

describe("pattern read — asset class", () => {
  const coin = () => holding({ ticker: "BTC", companyName: "Bitcoin", assetClass: "crypto", sector: null, industry: null });

  it("names the asset class instead of reporting a missing sector", () => {
    // "Not classified" reads as a data failure. For a coin it is not a
    // failure, and a read that treats it as one will report a gap that is not
    // there.
    const prompt = buildPatternReadUserContext({
      holdings: [coin()],
      objective: null,
      notes: [],
      today: "2026-09-05",
    });
    expect(prompt).toMatch(/Asset class: cryptocurrency/);
    expect(prompt).not.toMatch(/not classified by the data source/);
  });

  it("counts the mix, and says plainly that it is a count", () => {
    // This read has no prices and no quantities. A percentage here would have
    // to be invented, and an invented number in a prompt is indistinguishable
    // from a measured one by the time it reaches the output.
    const prompt = buildPatternReadUserContext({
      holdings: [holding(), coin()],
      objective: null,
      notes: [],
      today: "2026-09-05",
    });
    expect(prompt).toMatch(/1 of these is a cryptocurrency, and 1 is an equity/);
    expect(prompt).toMatch(/not shares of the money/);
  });

  it("still reports a real sector for an equity", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding()],
      objective: null,
      notes: [],
      today: "2026-09-05",
    });
    expect(prompt).toMatch(/Sector: Industrials/);
  });

  it("says nothing about asset class in an all-equity book", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding(), holding({ ticker: "VBL" })],
      objective: null,
      notes: [],
      today: "2026-09-05",
    });
    expect(prompt).not.toMatch(/cryptocurrenc/i);
  });
});

describe("pattern read — an all-crypto book", () => {
  const coin = (over = {}) =>
    holding({ ticker: "BTC", assetClass: "crypto", sector: null, industry: null, ...over });

  it("never tells an all-crypto book it also holds shares", () => {
    // Told "0 are equities" and then that they hold coins "alongside shares",
    // the model has a contradiction inside a block the prompt labels as fact.
    const prompt = buildPatternReadUserContext({
      holdings: [coin(), coin({ ticker: "ETH" })],
      objective: null,
      notes: [],
      today: "2026-09-05",
    });
    expect(prompt).toMatch(/2 of these are cryptocurrencies, and 0 are equities/);
    expect(prompt).not.toMatch(/alongside shares/);
    expect(prompt).toMatch(/entirely crypto/);
  });

  it("still says \"alongside shares\" when there IS a mix", () => {
    const prompt = buildPatternReadUserContext({
      holdings: [holding(), coin()],
      objective: null,
      notes: [],
      today: "2026-09-05",
    });
    expect(prompt).toMatch(/alongside shares/);
    expect(prompt).not.toMatch(/entirely crypto/);
  });
});
