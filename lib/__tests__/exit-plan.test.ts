import { describe, expect, it } from "vitest";

import {
  buildExitPlanUserContext,
  diffExitPlan,
  hasExitLevels,
  parseExitPlanProposal,
  sanitizeExitPlanGeometry,
  validateApprovedLevels,
  type ExitPlanLevels,
} from "@/lib/exit-plan";

const levels = (over: Partial<ExitPlanLevels> = {}): ExitPlanLevels => ({
  stop_loss: 90,
  target_1: 120,
  target_2: 150,
  time_exit_date: null,
  time_exit_condition: null,
  ...over,
});

const TODAY = "2026-09-01";

describe("sanitizeExitPlanGeometry", () => {
  it("keeps a plan that already holds together", () => {
    expect(sanitizeExitPlanGeometry(levels(), 100, TODAY)).toMatchObject({
      stop_loss: 90,
      target_1: 120,
      target_2: 150,
    });
  });

  it("drops a stop at or above the current price", () => {
    // A stop there is not a stop, it is a sell order that fires on save.
    expect(sanitizeExitPlanGeometry(levels({ stop_loss: 100 }), 100, TODAY).stop_loss).toBeNull();
    expect(sanitizeExitPlanGeometry(levels({ stop_loss: 110 }), 100, TODAY).stop_loss).toBeNull();
  });

  it("drops a target at or below the current price", () => {
    // Would render HIT the instant it was written, telling the trader nothing.
    const out = sanitizeExitPlanGeometry(levels({ target_1: 100, target_2: 150 }), 100, TODAY);
    expect(out.target_1).toBe(150);
    expect(out.target_2).toBeNull();
  });

  it("drops a second target that is not above the first", () => {
    expect(sanitizeExitPlanGeometry(levels({ target_2: 120 }), 100, TODAY).target_2).toBeNull();
    expect(sanitizeExitPlanGeometry(levels({ target_2: 110 }), 100, TODAY).target_2).toBeNull();
  });

  it("promotes a lone second target rather than losing the level", () => {
    const out = sanitizeExitPlanGeometry(levels({ target_1: null, target_2: 150 }), 100, TODAY);
    expect(out.target_1).toBe(150);
    expect(out.target_2).toBeNull();
  });

  it("drops non-positive and non-finite levels", () => {
    const out = sanitizeExitPlanGeometry(
      levels({ stop_loss: 0, target_1: -5, target_2: Number.NaN }),
      100,
      TODAY,
    );
    expect(out).toMatchObject({ stop_loss: null, target_1: null, target_2: null });
  });

  it("drops a time exit that is malformed or already past", () => {
    expect(sanitizeExitPlanGeometry(levels({ time_exit_date: "next March" }), 100, TODAY).time_exit_date).toBeNull();
    expect(sanitizeExitPlanGeometry(levels({ time_exit_date: "2026-08-01" }), 100, TODAY).time_exit_date).toBeNull();
    expect(sanitizeExitPlanGeometry(levels({ time_exit_date: TODAY }), 100, TODAY).time_exit_date).toBeNull();
    expect(sanitizeExitPlanGeometry(levels({ time_exit_date: "2027-03-01" }), 100, TODAY).time_exit_date).toBe("2027-03-01");
  });

  it("drops the time-exit condition along with the date it described", () => {
    const out = sanitizeExitPlanGeometry(
      levels({ time_exit_date: "2020-01-01", time_exit_condition: "if the order book hasn't converted" }),
      100,
      TODAY,
    );
    expect(out.time_exit_date).toBeNull();
    expect(out.time_exit_condition).toBeNull();
  });

  it("checks ordering but not the price when there is no price", () => {
    const out = sanitizeExitPlanGeometry(levels({ stop_loss: 200, target_2: 110 }), null, TODAY);
    // 200 would be above any sane price, but with no price there is nothing to
    // compare it against — only the relative checks can run.
    expect(out.stop_loss).toBe(200);
    expect(out.target_2).toBeNull();
  });
});

describe("validateApprovedLevels", () => {
  it("accepts a plan that holds together, and one that is entirely empty", () => {
    expect(validateApprovedLevels(levels()).ok).toBe(true);
    expect(
      validateApprovedLevels(levels({ stop_loss: null, target_1: null, target_2: null })).ok,
    ).toBe(true);
  });

  it("refuses rather than silently discarding a trader's own bad number", () => {
    // The difference from the sanitizer: a level someone deliberately typed
    // must never vanish on a successful save.
    const out = validateApprovedLevels(levels({ stop_loss: 130 }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/below your first target/i);
  });

  it("refuses a second target that is not above the first", () => {
    expect(validateApprovedLevels(levels({ target_2: 100 })).ok).toBe(false);
  });

  it("refuses a second target with no first", () => {
    expect(validateApprovedLevels(levels({ target_1: null })).ok).toBe(false);
  });

  it("refuses a level at or below zero", () => {
    const out = validateApprovedLevels(levels({ stop_loss: 0 }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/above zero/i);
  });

  it("refuses a malformed time exit", () => {
    expect(validateApprovedLevels(levels({ time_exit_date: "soon" })).ok).toBe(false);
  });

  it("refuses a stop at or above the current price", () => {
    // `poll-prices` fires on `price <= stop_loss`, so saving one of these would
    // raise a stop-breach alert on the very next run — a "get out" on a
    // position that is fine.
    const at = validateApprovedLevels(levels({ stop_loss: 100 }), 100);
    expect(at.ok).toBe(false);
    if (!at.ok) expect(at.error).toMatch(/at or above the current price/i);
    expect(validateApprovedLevels(levels({ stop_loss: 110 }), 100).ok).toBe(false);
    expect(validateApprovedLevels(levels({ stop_loss: 99 }), 100).ok).toBe(true);
  });

  it("allows a target the holding has already passed", () => {
    // Not an oversight: "I should have trimmed at 90 and I am past it" is a
    // real instruction, and the ladder showing HIT is the true answer. A stop
    // above the price has no such reading, which is why only that one refuses.
    expect(validateApprovedLevels(levels({ stop_loss: 80, target_1: 90, target_2: 95 }), 100).ok).toBe(true);
  });

  it("skips the price rule when there is no usable price", () => {
    expect(validateApprovedLevels(levels({ stop_loss: 110 }), null).ok).toBe(true);
    expect(validateApprovedLevels(levels({ stop_loss: 110 }), 0).ok).toBe(true);
  });
});

describe("parseExitPlanProposal", () => {
  const good = {
    stop_loss: 90,
    target_1: 120,
    target_2: 150,
    time_exit_date: null,
    time_exit_condition: null,
    reasoning: { stop_loss: "a", target_1: "b", target_2: "c", time_exit: null },
    grounded_in: ["Trailing P/E 20"],
  };

  it("reads the trailing fenced block, prose above and all", () => {
    const out = parseExitPlanProposal("here you go\n\n```json\n" + JSON.stringify(good) + "\n```");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.stop_loss).toBe(90);
  });

  it("costs one field, not the whole proposal, when an answer is thin", () => {
    const out = parseExitPlanProposal(
      "```json\n" + JSON.stringify({ ...good, target_2: "about 150", grounded_in: "nope" }) + "\n```",
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.target_2).toBeNull();
      expect(out.data.grounded_in).toEqual([]);
      expect(out.data.stop_loss).toBe(90);
    }
  });

  it("reports rather than throws when there is no block", () => {
    const out = parseExitPlanProposal("I could not do this.");
    expect(out.ok).toBe(false);
  });
});

describe("hasExitLevels", () => {
  it("is false for the all-null plan an import writes", () => {
    expect(hasExitLevels({ stop_loss: null, target_1: null, target_2: null })).toBe(false);
    expect(hasExitLevels(null)).toBe(false);
  });

  it("is true once any single level is set", () => {
    expect(hasExitLevels({ stop_loss: 90, target_1: null, target_2: null })).toBe(true);
    expect(hasExitLevels({ stop_loss: null, target_1: null, target_2: 150 })).toBe(true);
  });
});

describe("diffExitPlan", () => {
  it("names only what the trader actually changed", () => {
    expect(diffExitPlan(levels(), levels())).toEqual([]);
    expect(diffExitPlan(levels(), levels({ stop_loss: 85 }))).toEqual(["stop_loss"]);
  });

  it("counts clearing a level as an edit", () => {
    expect(diffExitPlan(levels(), levels({ target_2: null }))).toEqual(["target_2"]);
  });
});

describe("buildExitPlanUserContext", () => {
  const context = () =>
    buildExitPlanUserContext({
      ticker: "HAL",
      companyName: null,
      currency: "INR",
      quantity: 10,
      averagePrice: 4000,
      currentPrice: 4500,
      rationale: "Defence order book and the government capex cycle.",
      objective: "Long-term compounding.",
      heldSince: "2026-01-15",
      fundamentals: { trailingPE: 32 },
      today: TODAY,
    });

  it("carries the trader's own reason, which is what the stop is anchored to", () => {
    expect(context()).toContain("Defence order book and the government capex cycle.");
  });

  it("states the price the levels are measured against, and the date", () => {
    const out = context();
    expect(out).toContain("The current price is 4500 INR");
    expect(out).toContain(TODAY);
  });

  it("reuses the shared holding block rather than restating the position", () => {
    const out = context();
    expect(out).toContain("THE HOLDING");
    expect(out).toContain("Average cost: 4000 INR");
    expect(out).toContain("Unrealized: +12.5%");
    expect(out).toContain("FUNDAMENTALS NOW");
  });

  it("passes the portfolio objective through when one is set", () => {
    expect(context()).toContain("Long-term compounding.");
  });
});
