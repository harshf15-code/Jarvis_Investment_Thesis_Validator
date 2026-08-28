import { describe, expect, it } from "vitest";

import {
  parseCandidateShortlist,
  sanitizeTradePlanGeometry,
  type TradePlanLevels,
} from "@/lib/jarvis-thesis-parser";
import { parseMemorandum, type Memorandum } from "@/lib/jarvis-memorandum";

function fence(obj: unknown): string {
  return "some prose\n\n```json\n" + JSON.stringify(obj) + "\n```";
}

describe("parseCandidateShortlist", () => {
  it("reads a well-formed shortlist", () => {
    const result = parseCandidateShortlist(
      fence({ candidates: [{ ticker: "BAJFINANCE", company_name: "Bajaj Finance" }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.candidates[0].ticker).toBe("BAJFINANCE");
  });

  it("fails closed when there is no json fence", () => {
    expect(parseCandidateShortlist("I could not find any candidates.").ok).toBe(false);
  });

  it("rejects an empty candidate list rather than returning zero names", () => {
    expect(parseCandidateShortlist(fence({ candidates: [] })).ok).toBe(false);
  });
});

describe("sanitizeTradePlanGeometry", () => {
  const levels = (over: Partial<TradePlanLevels> = {}): TradePlanLevels => ({
    entry_zone_low: 100,
    entry_zone_high: 110,
    add_tranche_low: 90,
    add_tranche_high: 95,
    stop_loss: 85,
    target_1: 130,
    target_2: 150,
    position_size_pct: 5,
    time_exit_date: "2026-12-31",
    ...over,
  });

  it("leaves a coherent plan untouched", () => {
    const input = levels();
    expect(sanitizeTradePlanGeometry(input)).toEqual(input);
  });

  it("drops a stop at or above the add tranche", () => {
    expect(sanitizeTradePlanGeometry(levels({ stop_loss: 95 })).stop_loss).toBeNull();
  });

  it("falls back to the entry zone as the stop's floor when there is no add tranche", () => {
    const out = sanitizeTradePlanGeometry(
      levels({ add_tranche_low: null, add_tranche_high: null, stop_loss: 105 }),
    );
    expect(out.stop_loss).toBeNull();
  });

  it("drops a target that is not above the entry zone", () => {
    expect(sanitizeTradePlanGeometry(levels({ target_1: 105 })).target_1).toBeNull();
  });

  it("drops target_2 when it is not above target_1", () => {
    expect(sanitizeTradePlanGeometry(levels({ target_2: 120 })).target_2).toBeNull();
  });

  it("swaps a reversed entry zone instead of discarding both bounds", () => {
    const out = sanitizeTradePlanGeometry(levels({ entry_zone_low: 110, entry_zone_high: 100 }));
    expect(out.entry_zone_low).toBe(100);
    expect(out.entry_zone_high).toBe(110);
  });

  it("drops non-positive prices", () => {
    expect(sanitizeTradePlanGeometry(levels({ entry_zone_low: 0 })).entry_zone_low).toBeNull();
    expect(sanitizeTradePlanGeometry(levels({ target_1: -5 })).target_1).toBeNull();
  });

  it("drops an out-of-range position size", () => {
    expect(sanitizeTradePlanGeometry(levels({ position_size_pct: 140 })).position_size_pct).toBeNull();
    expect(sanitizeTradePlanGeometry(levels({ position_size_pct: 0 })).position_size_pct).toBeNull();
  });

  it("drops a malformed or impossible exit date", () => {
    expect(sanitizeTradePlanGeometry(levels({ time_exit_date: "next quarter" })).time_exit_date).toBeNull();
    expect(sanitizeTradePlanGeometry(levels({ time_exit_date: "2026-13-01" })).time_exit_date).toBeNull();
  });

  it("preserves fields it doesn't own", () => {
    const out = sanitizeTradePlanGeometry({ ...levels(), time_exit_condition: "share > 15%" });
    expect(out.time_exit_condition).toBe("share > 15%");
  });
});

/* -------------------------------------------------------------------------- */

const cell = { value: "x", sub: "y" };

function memoDoc(over: Record<string, unknown> = {}) {
  return {
    header: { system_id: "Jarvis", sector_theme: "India EV", title: "Pick A Winner", data_source: "NSE" },
    candidates: [
      { ticker: "AAA", company_name: "A Ltd", valuation_metric: "26×", market_cap: "₹1 Cr", operational_share: "20%", verdict: "BUY", tagline: "PICK", is_primary_pick: true },
      { ticker: "BBB", company_name: "B Ltd", valuation_metric: "56×", market_cap: "₹2 Cr", operational_share: "24%", verdict: "WATCH", tagline: "PRICEY", is_primary_pick: false },
    ],
    primary_ticker: "AAA",
    secondary_ticker: "BBB",
    execution_status: "Conditional Buy",
    thesis: {
      section_header: "Tier II — A Ltd",
      market_view: "mv",
      mispricing: "mp",
      catalysts: ["c1", "c2"],
      peer_commentary: [{ ticker: "BBB", valuation: "56×", tone: "negative", note: "too dear" }],
      time_horizon_invalidation: "12 months",
      conviction_score: 74,
      secondary: null,
    },
    stress_test: {
      failure_modes: [{ title: "t", bear_case: "b", counter: "c" }],
      verdict: "v",
    },
    trade_plan: {
      section_header: "Trade Plan",
      cells: {
        cmp: cell, entry_zone: cell, add_tranche: cell, stop_loss: cell, target_1: cell,
        target_2: cell, position_size: cell, time_horizon: cell, time_exit: cell,
      },
      numeric: {
        entry_zone_low: 100, entry_zone_high: 110, add_tranche_low: 90, add_tranche_high: 95,
        stop_loss: 85, target_1: 130, target_2: 150, position_size_pct: 5,
        time_exit_date: "2026-12-31", time_exit_condition: "share > 15%",
      },
      test_calendar: [{ timeframe: "Jul 2026", event: "Q1", test: "≥50k units" }],
      parallel_plan: null,
    },
    exit: {
      section_header: "Exit",
      rules: [{ kind: "trim", headline: "h", detail: "d" }],
      warning: { anchor_metric: "monthly share", text: "w" },
      verdict_cells: { risk_reward: cell, max_drawdown: cell, tier: cell, peg: cell },
    },
    ...over,
  };
}

describe("parseMemorandum", () => {
  it("reads a complete memorandum", () => {
    const result = parseMemorandum(fence(memoDoc()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primary_ticker).toBe("AAA");
      expect(result.data.trade_plan.numeric.stop_loss).toBe(85);
    }
  });

  it("fails closed with no json fence", () => {
    expect(parseMemorandum("no json here").ok).toBe(false);
  });

  it("survives a thin section instead of rejecting the whole memo", () => {
    const thin = memoDoc({
      thesis: { ...memoDoc().thesis, catalysts: "not an array", secondary: "nonsense" },
    });
    const result = parseMemorandum(fence(thin));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.thesis.catalysts).toEqual([]);
      expect(result.data.thesis.secondary).toBeNull();
      // The rest of the document is intact.
      expect(result.data.thesis.market_view).toBe("mv");
    }
  });

  it("rejects a memo with no candidates at all", () => {
    expect(parseMemorandum(fence(memoDoc({ candidates: [] }))).ok).toBe(false);
  });
});

describe("normalizeMemorandum", () => {
  function parsed(over: Record<string, unknown> = {}): Memorandum {
    const r = parseMemorandum(fence(memoDoc(over)));
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  it("demotes a second BUY so exactly one column is the pick", () => {
    const memo = parsed({
      candidates: [
        { ...memoDoc().candidates[0] },
        { ...memoDoc().candidates[1], verdict: "BUY", is_primary_pick: true },
      ],
    });
    expect(memo.candidates.filter((c) => c.is_primary_pick)).toHaveLength(1);
    expect(memo.candidates.filter((c) => c.verdict === "BUY")).toHaveLength(1);
    expect(memo.primary_ticker).toBe("AAA");
  });

  it("repairs a primary_ticker that names no candidate", () => {
    const memo = parsed({ primary_ticker: "ZZZ" });
    // Falls back to the flagged pick rather than leaving the grid with none.
    expect(memo.primary_ticker).toBe("AAA");
    expect(memo.candidates[0].is_primary_pick).toBe(true);
  });

  it("keeps primary_ticker and the flag in agreement when they disagree", () => {
    const memo = parsed({
      primary_ticker: "BBB",
      candidates: [
        { ...memoDoc().candidates[0], is_primary_pick: true, verdict: "BUY" },
        { ...memoDoc().candidates[1], is_primary_pick: false, verdict: "WATCH" },
      ],
    });
    // primary_ticker wins — it is the field the memo's prose is written about.
    expect(memo.primary_ticker).toBe("BBB");
    expect(memo.candidates.find((c) => c.ticker === "BBB")?.is_primary_pick).toBe(true);
    expect(memo.candidates.find((c) => c.ticker === "AAA")?.is_primary_pick).toBe(false);
    expect(memo.candidates.find((c) => c.ticker === "AAA")?.verdict).toBe("WATCH");
  });

  it("drops an incoherent stop from numeric but leaves the display cell alone", () => {
    const doc = memoDoc();
    const memo = parsed({
      trade_plan: {
        ...doc.trade_plan,
        cells: { ...doc.trade_plan.cells, stop_loss: { value: "₹200", sub: "weekly close" } },
        numeric: { ...doc.trade_plan.numeric, stop_loss: 200 },
      },
    });
    expect(memo.trade_plan.numeric.stop_loss).toBeNull();
    expect(memo.trade_plan.cells.stop_loss.value).toBe("₹200");
  });
});
