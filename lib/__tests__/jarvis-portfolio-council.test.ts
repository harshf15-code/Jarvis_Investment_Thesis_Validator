import { describe, expect, it } from "vitest";

import {
  aggregateByListing,
  buildPortfolioOpinionUserContext,
  consensusCalls,
  callsByTicker,
  normalizePortfolioCouncilReport,
  parsePortfolioOpinion,
  portfolioCouncilTally,
  splitByCurrency,
  type CouncilHolding,
  type PortfolioCouncilReport,
} from "@/lib/jarvis-portfolio-council";

function holding(over: Partial<CouncilHolding> = {}): CouncilHolding {
  return {
    ticker: "INFY",
    companyName: "Infosys",
    currency: "INR",
    assetClass: "equity",
    quantity: 10,
    averagePrice: 1400,
    currentPrice: 1200,
    fundamentals: {},
    rationale: null,
    hasTradePlan: false,
    imported: true,
    ...over,
  };
}

const fenced = (o: unknown) => "prose\n\n```json\n" + JSON.stringify(o) + "\n```";

const OPINION = {
  headline: "Too much in one place.",
  structural_read: { concentration: "c", diversification: "d", sizing: "s", cash: "x" },
  holding_calls: [{ ticker: "INFY", call: "TRIM", reason: "Half the book." }],
  biggest_risk: "One name decides the year.",
};

function report(over: Partial<PortfolioCouncilReport> = {}): PortfolioCouncilReport {
  return {
    opinions: [
      { member_id: "m1", member_name: "A", source: "builtin", opinion: OPINION as never, error: null },
    ],
    synthesis: null,
    synthesis_skipped: null,
    generated_at: "2026-08-31T00:00:00Z",
    ...over,
  };
}

describe("splitByCurrency", () => {
  it("weights WITHIN a currency and never across", () => {
    // The whole point: no exchange rate exists here, so a weight can only ever
    // be a share of its own sub-book.
    const books = splitByCurrency([
      holding({ ticker: "INFY", currency: "INR", quantity: 10, currentPrice: 1000 }), // 10,000
      holding({ ticker: "TCS", currency: "INR", quantity: 10, currentPrice: 3000 }), // 30,000
      holding({ ticker: "AAPL", currency: "USD", quantity: 10, currentPrice: 200 }), // 2,000
    ]);

    expect(books.map((b) => b.currency)).toEqual(["INR", "USD"]);
    const inr = books[0];
    expect(inr.holdings.map((h) => h.ticker)).toEqual(["TCS", "INFY"]); // heaviest first
    expect(inr.holdings[0].weightPct).toBeCloseTo(75);
    expect(inr.holdings[1].weightPct).toBeCloseTo(25);
    // AAPL is 100% of the USD book, not 4% of some blended total.
    expect(books[1].holdings[0].weightPct).toBeCloseTo(100);
  });

  it("lists an unpriceable holding with a null weight rather than dropping it", () => {
    // Hiding it would flatter the weights of everything else.
    const [book] = splitByCurrency([
      holding({ ticker: "INFY", currentPrice: 1000, quantity: 10 }),
      holding({ ticker: "GHOST", currentPrice: null }),
    ]);
    expect(book.holdings).toHaveLength(2);
    const ghost = book.holdings.find((h) => h.ticker === "GHOST");
    expect(ghost?.weightPct).toBeNull();
    // It contributes no market value, so INFY is still 100% of what can be valued.
    expect(book.holdings.find((h) => h.ticker === "INFY")?.weightPct).toBeCloseTo(100);
  });

  it("puts the larger book first", () => {
    const books = splitByCurrency([
      holding({ currency: "USD", averagePrice: 500, quantity: 100 }),
      holding({ currency: "INR", averagePrice: 10, quantity: 1 }),
    ]);
    expect(books[0].currency).toBe("USD");
  });
});

describe("aggregateByListing", () => {
  it("collapses two positions in the same listing into one holding", () => {
    // A trader can hold the same name through separate theses. Left apart, the
    // panel sees INFY twice at half the weight and judges the concentration of
    // neither — the one number a structural read most depends on.
    const [merged] = aggregateByListing([
      holding({ ticker: "INFY", quantity: 10, averagePrice: 1000, currentPrice: 1200 }),
      holding({ ticker: "INFY", quantity: 30, averagePrice: 2000, currentPrice: 1200 }),
    ]);
    expect(merged.quantity).toBe(40);
    // Cost re-weighted across both legs: (10*1000 + 30*2000) / 40.
    expect(merged.averagePrice).toBe(1750);
  });

  it("keeps the same ticker in two currencies apart", () => {
    // The NSE line and the NYSE ADR are different instruments, which is the
    // whole reason a batch names one market.
    const out = aggregateByListing([
      holding({ ticker: "INFY", currency: "INR" }),
      holding({ ticker: "INFY", currency: "USD" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps every rationale and does not lose a planned leg", () => {
    const [merged] = aggregateByListing([
      holding({ ticker: "INFY", rationale: "Cash conversion.", hasTradePlan: false, imported: true }),
      holding({ ticker: "INFY", rationale: "Buyback.", hasTradePlan: true, imported: false }),
    ]);
    expect(merged.rationale).toBe("Cash conversion. / Buyback.");
    expect(merged.hasTradePlan).toBe(true);
    // Only wholly-imported when every leg was.
    expect(merged.imported).toBe(false);
  });
});

describe("consensusCalls", () => {
  it("names only a call more than one member actually made", () => {
    // The UI renders this under "More than one member said the same thing", so
    // a lone opinion promoted into a panel view would make that label false.
    const r = report({
      opinions: [
        { member_id: "1", member_name: "A", source: "builtin", opinion: { ...OPINION, holding_calls: [{ ticker: "INFY", call: "TRIM", reason: "r" }] } as never, error: null },
        { member_id: "2", member_name: "B", source: "builtin", opinion: { ...OPINION, holding_calls: [{ ticker: "INFY", call: "TRIM", reason: "r" }] } as never, error: null },
        { member_id: "3", member_name: "C", source: "builtin", opinion: { ...OPINION, holding_calls: [{ ticker: "TCS", call: "ADD", reason: "r" }] } as never, error: null },
      ],
    });
    expect(consensusCalls(r)).toEqual(["INFY TRIM"]);
  });

  it("ignores agreement to do nothing", () => {
    // "Three members agree to hold" is not a headline; HOLD recommends no action.
    const r = report({
      opinions: [
        { member_id: "1", member_name: "A", source: "builtin", opinion: { ...OPINION, holding_calls: [{ ticker: "INFY", call: "HOLD", reason: "r" }] } as never, error: null },
        { member_id: "2", member_name: "B", source: "builtin", opinion: { ...OPINION, holding_calls: [{ ticker: "INFY", call: "HOLD", reason: "r" }] } as never, error: null },
      ],
    });
    expect(consensusCalls(r)).toEqual([]);
  });

  it("replaces a synthesis claim the cards do not support", () => {
    // `loudest_calls` is model output about other model output. Left as
    // written it could name a ticker normalisation had just stripped.
    const normalized = normalizePortfolioCouncilReport(
      report({
        opinions: [
          { member_id: "1", member_name: "A", source: "builtin", opinion: { ...OPINION, holding_calls: [{ ticker: "NVDA", call: "TRIM", reason: "r" }] } as never, error: null },
        ],
        synthesis: {
          summary: "s", where_they_agree: [], where_they_diverge: [], loudest_calls: ["NVDA TRIM"],
        } as never,
      }),
      ["INFY"],
    );
    expect(normalized.synthesis?.loudest_calls).toEqual([]);
  });
});

describe("the briefing", () => {
  it("tells the panel outright that cross-currency concentration is off limits", () => {
    const context = buildPortfolioOpinionUserContext({
      books: splitByCurrency([holding({ currency: "INR" }), holding({ ticker: "AAPL", currency: "USD" })]),
      objective: null,
      totalPositions: 2,
    });
    expect(context).toContain("NO EXCHANGE RATE HAS BEEN APPLIED");
    expect(context).toContain("cannot be compared or added");
  });

  it("says nothing about sub-books when the book is one currency", () => {
    const context = buildPortfolioOpinionUserContext({
      books: splitByCurrency([holding(), holding({ ticker: "TCS" })]),
      objective: "Retire at 50.",
      totalPositions: 2,
    });
    expect(context).not.toContain("NO EXCHANGE RATE HAS BEEN APPLIED");
    expect(context).toContain("Retire at 50.");
  });

  it("flags a position that has never been sized to a plan", () => {
    const context = buildPortfolioOpinionUserContext({
      books: splitByCurrency([holding({ hasTradePlan: false })]),
      objective: null,
      totalPositions: 1,
    });
    expect(context).toContain("never been sized to a plan");
  });

  it("says what it would need when no objective was set", () => {
    const context = buildPortfolioOpinionUserContext({
      books: splitByCurrency([holding()]),
      objective: null,
      totalPositions: 1,
    });
    expect(context).toContain("have not stated an objective");
  });
});

describe("normalizePortfolioCouncilReport", () => {
  it("drops a call on a ticker the trader does not hold", () => {
    // A ticker under a TRIM badge reads as an instruction whether or not
    // anyone owns it. "Trim your NVDA" to someone with no NVDA is worse than
    // silence.
    const normalized = normalizePortfolioCouncilReport(
      report({
        opinions: [
          {
            member_id: "m1",
            member_name: "A",
            source: "builtin",
            opinion: {
              ...OPINION,
              holding_calls: [
                { ticker: "INFY", call: "TRIM", reason: "r" },
                { ticker: "NVDA", call: "ADD", reason: "invented" },
              ],
            } as never,
            error: null,
          },
        ],
      }),
      ["INFY", "TCS"],
    );
    expect(normalized.opinions[0].opinion?.holding_calls.map((c) => c.ticker)).toEqual(["INFY"]);
  });

  it("keeps the structural read of a member whose calls were all dropped", () => {
    const normalized = normalizePortfolioCouncilReport(
      report({
        opinions: [
          {
            member_id: "m1",
            member_name: "A",
            source: "builtin",
            opinion: { ...OPINION, holding_calls: [{ ticker: "NVDA", call: "ADD", reason: "r" }] } as never,
            error: null,
          },
        ],
      }),
      ["INFY"],
    );
    expect(normalized.opinions[0].opinion?.holding_calls).toEqual([]);
    expect(normalized.opinions[0].opinion?.structural_read.concentration).toBe("c");
  });

  it("matches tickers case- and whitespace-insensitively, and normalises them", () => {
    const normalized = normalizePortfolioCouncilReport(
      report({
        opinions: [
          {
            member_id: "m1",
            member_name: "A",
            source: "builtin",
            opinion: { ...OPINION, holding_calls: [{ ticker: " infy ", call: "TRIM", reason: "r" }] } as never,
            error: null,
          },
        ],
      }),
      ["INFY"],
    );
    expect(normalized.opinions[0].opinion?.holding_calls[0].ticker).toBe("INFY");
  });

  it("leaves a failed member's card alone", () => {
    const normalized = normalizePortfolioCouncilReport(
      report({
        opinions: [
          { member_id: "m1", member_name: "A", source: "builtin", opinion: null, error: "timed out" },
        ],
      }),
      ["INFY"],
    );
    expect(normalized.opinions[0].error).toBe("timed out");
  });
});

describe("parsePortfolioOpinion", () => {
  it("degrades a thin answer without losing the card", () => {
    const parsed = parsePortfolioOpinion(
      fenced({
        headline: "Fine.",
        structural_read: { concentration: null, diversification: 5, sizing: "s", cash: null },
        holding_calls: "not an array",
        biggest_risk: null,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.headline).toBe("Fine.");
    expect(parsed.data.structural_read.diversification).toBeNull();
    expect(parsed.data.holding_calls).toEqual([]);
  });

  it("does not silently turn an unreadable call into HOLD at the top level", () => {
    const parsed = parsePortfolioOpinion(
      fenced({ ...OPINION, holding_calls: [{ ticker: "INFY", call: "SELL EVERYTHING", reason: "r" }] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The enum's `.catch` is the last line of defence, and HOLD is the only
    // safe default — it recommends no action.
    expect(parsed.data.holding_calls[0].call).toBe("HOLD");
  });

  it("reports a missing block rather than throwing", () => {
    const parsed = parsePortfolioOpinion("no json here");
    expect(parsed.ok).toBe(false);
  });
});

describe("tally and grouping", () => {
  it("counts silence as a member with no calls, not as a HOLD", () => {
    // Silence on a holding is "no strong view", and counting it as HOLD would
    // manufacture a panel consensus nobody expressed.
    const tally = portfolioCouncilTally(
      report({
        opinions: [
          { member_id: "m1", member_name: "A", source: "builtin", opinion: OPINION as never, error: null },
          {
            member_id: "m2",
            member_name: "B",
            source: "custom",
            opinion: { ...OPINION, holding_calls: [] } as never,
            error: null,
          },
          { member_id: "m3", member_name: "C", source: "custom", opinion: null, error: "boom" },
        ],
      }),
    );
    expect(tally).toEqual({ answered: 2, failed: 1, withCalls: 1, trim: 1, add: 0, hold: 0 });
  });

  it("groups every call made about one ticker", () => {
    const grouped = callsByTicker(
      report({
        opinions: [
          { member_id: "m1", member_name: "A", source: "builtin", opinion: OPINION as never, error: null },
          {
            member_id: "m2",
            member_name: "B",
            source: "custom",
            opinion: { ...OPINION, holding_calls: [{ ticker: "INFY", call: "ADD", reason: "cheap" }] } as never,
            error: null,
          },
        ],
      }),
    );
    expect(grouped.get("INFY")).toEqual([
      { member: "A", call: "TRIM", reason: "Half the book." },
      { member: "B", call: "ADD", reason: "cheap" },
    ]);
  });
});

describe("asset-class exposure", () => {
  const btc = () =>
    holding({
      ticker: "BTC",
      companyName: "Bitcoin",
      assetClass: "crypto",
      quantity: 1,
      averagePrice: 5_000_000,
      currentPrice: 7_500_000,
    });
  // 10 x 1200 = 12,000 INR of equity against 7,500,000 of BTC.
  const infy = () => holding({ currentPrice: 1200, quantity: 10 });

  it("reports each asset class's share of the sub-book", () => {
    const [book] = splitByCurrency([infy(), btc()]);
    const crypto = book.exposure.find((e) => e.assetClass === "crypto");
    const equity = book.exposure.find((e) => e.assetClass === "equity");
    expect(crypto?.pct).toBeCloseTo((7_500_000 / 7_512_000) * 100, 4);
    expect(equity?.pct).toBeCloseTo((12_000 / 7_512_000) * 100, 4);
  });

  it("orders it biggest first", () => {
    const [book] = splitByCurrency([infy(), btc()]);
    expect(book.exposure.map((e) => e.assetClass)).toEqual(["crypto", "equity"]);
  });

  it("computes it WITHIN a currency, never across two", () => {
    // There is no honest total across INR and USD without an exchange rate
    // this app does not hold. A cross-currency asset-class percentage would be
    // the one number in the prompt that quietly required an FX assumption.
    const books = splitByCurrency([infy(), holding({ ticker: "AAPL", currency: "USD", currentPrice: 200 })]);
    expect(books).toHaveLength(2);
    for (const b of books) {
      expect(b.exposure).toEqual([{ assetClass: "equity", marketValue: expect.any(Number), pct: 100 }]);
    }
  });

  it("excludes an unpriced holding, exactly as weights do", () => {
    const [book] = splitByCurrency([infy(), btc(), holding({ ticker: "TCS", currentPrice: null })]);
    const total = book.exposure.reduce((sum, e) => sum + e.pct, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("reports nothing when nothing in the sub-book would price", () => {
    const [book] = splitByCurrency([holding({ currentPrice: null })]);
    expect(book.exposure).toEqual([]);
  });

  it("puts the exposure in the prompt, above the holdings", () => {
    const prompt = buildPortfolioOpinionUserContext({
      books: splitByCurrency([infy(), btc()]),
      objective: "Retirement in twenty years.",
      totalPositions: 2,
    });
    expect(prompt).toMatch(/Asset-class exposure: 99.8% crypto, 0.2% equities/);
    expect(prompt.indexOf("Asset-class exposure")).toBeLessThan(prompt.indexOf("- BTC"));
  });

  it("tells the panel a coin has no fundamentals to fault it for", () => {
    // The single most useful thing a Council can say about a book holding
    // crypto is how much of it is crypto -- not that the coin lacks a P/E.
    const prompt = buildPortfolioOpinionUserContext({
      books: splitByCurrency([infy(), btc()]),
      objective: null,
      totalPositions: 2,
    });
    expect(prompt).toMatch(/do not fault it for lacking one/);
    expect(prompt).toMatch(/Asset class: cryptocurrency/);
  });

  it("says nothing about crypto in an all-equity book", () => {
    const prompt = buildPortfolioOpinionUserContext({
      books: splitByCurrency([infy(), holding({ ticker: "TCS", currentPrice: 3000 })]),
      objective: null,
      totalPositions: 2,
    });
    expect(prompt).not.toMatch(/cryptocurrency/i);
    expect(prompt).toMatch(/Asset-class exposure: 100.0% equities/);
  });
});

describe("aggregateByListing — asset class in the key", () => {
  it("keeps a coin and an equity with the same ticker apart", () => {
    // Not hypothetical: a spot-Bitcoin trust can list under the very symbol its
    // coin uses. Collapsed, the row's quantity adds coin units to share counts,
    // its price is whichever leg priced first, and its asset class is whichever
    // was seen first — market value, weight and exposure all wrong at once.
    const rows = aggregateByListing([
      holding({ ticker: "BTC", currency: "USD", assetClass: "crypto", quantity: 2, currentPrice: 90_000 }),
      holding({ ticker: "BTC", currency: "USD", assetClass: "equity", quantity: 100, currentPrice: 60 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.assetClass === "crypto")?.quantity).toBe(2);
    expect(rows.find((r) => r.assetClass === "equity")?.quantity).toBe(100);
  });

  it("still merges two positions in the SAME coin", () => {
    // The whole purpose of aggregation is unchanged: one listing, one row.
    const rows = aggregateByListing([
      holding({ ticker: "BTC", currency: "INR", assetClass: "crypto", quantity: 1, averagePrice: 100 }),
      holding({ ticker: "BTC", currency: "INR", assetClass: "crypto", quantity: 3, averagePrice: 200 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(4);
  });

  it("weighs the collision correctly once separated", () => {
    const [book] = splitByCurrency(
      aggregateByListing([
        holding({ ticker: "BTC", currency: "USD", assetClass: "crypto", quantity: 1, currentPrice: 90_000 }),
        holding({ ticker: "BTC", currency: "USD", assetClass: "equity", quantity: 100, currentPrice: 100 }),
      ]),
    );
    const crypto = book.exposure.find((e) => e.assetClass === "crypto");
    expect(crypto?.pct).toBeCloseTo(90, 6);
  });
});
