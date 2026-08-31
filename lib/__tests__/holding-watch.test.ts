import { describe, expect, it } from "vitest";

import {
  EARNINGS_WINDOW_DAYS,
  FUNDAMENTALS_DELTA_PCT,
  daysBetween,
  detectTriggers,
  diffFundamentals,
  parseHoldingRead,
  signalHeadline,
  signalPriority,
  type WatchObservation,
  type WatchState,
} from "@/lib/holding-watch";

const TODAY = "2026-08-31";

function state(over: Partial<WatchState> = {}): WatchState {
  return { fundamentals: {}, nextEarningsDate: null, lastEarningsSeen: null, ...over };
}

function observed(over: Partial<WatchObservation> = {}): WatchObservation {
  return { fundamentals: {}, earningsDates: [], earningsDateIsEstimate: false, ...over };
}

const fire = (s: WatchState, o: WatchObservation, today = TODAY) =>
  detectTriggers({ state: s, observed: o, today });

describe("daysBetween", () => {
  it("counts forward and backward across a month boundary", () => {
    expect(daysBetween("2026-08-31", "2026-09-02")).toBe(2);
    expect(daysBetween("2026-08-31", "2026-08-28")).toBe(-3);
    expect(daysBetween("2026-08-31", "2026-08-31")).toBe(0);
  });
});

describe("diffFundamentals", () => {
  it("fires on a move at the threshold and stays quiet just below it", () => {
    expect(diffFundamentals({ trailingPE: 20 }, { trailingPE: 23 })).toHaveLength(1);
    // 20 -> 22.9 is 14.5%, under FUNDAMENTALS_DELTA_PCT.
    expect(diffFundamentals({ trailingPE: 20 }, { trailingPE: 22.9 })).toEqual([]);
    expect(FUNDAMENTALS_DELTA_PCT).toBe(15);
  });

  it("fires on a sign flip however small the absolute move", () => {
    // +0.4% margin to -0.2%. Tiny in absolute terms, and a different company.
    const [change] = diffFundamentals({ profitMargins: 0.004 }, { profitMargins: -0.002 });
    expect(change).toMatchObject({ key: "profitMargins", percentChange: null });
  });

  it("does not report a metric absent from either side", () => {
    // Yahoo omits fields per instrument type. "This ADR does not report
    // operating margin" is not news about the business.
    expect(diffFundamentals({ trailingPE: 20 }, {})).toEqual([]);
    expect(diffFundamentals({}, { trailingPE: 20 })).toEqual([]);
  });

  it("ignores a metric nobody watches, however far it moved", () => {
    // Market cap moves with the price every day; it would fire every week for
    // every holding and mean nothing.
    expect(diffFundamentals({ marketCap: 1e9 }, { marketCap: 5e9 })).toEqual([]);
  });

  it("skips a zero baseline rather than reporting an infinite move", () => {
    expect(diffFundamentals({ revenueGrowth: 0 }, { revenueGrowth: 0.3 })).toEqual([]);
  });

  it("reads numeric strings, which is how jsonb round-trips some values", () => {
    expect(diffFundamentals({ trailingPE: "20" }, { trailingPE: 30 })).toHaveLength(1);
  });
});

describe("detectTriggers — earnings", () => {
  it("fires once when a date enters the window, and not again as it nears", () => {
    const soon = "2026-09-05"; // 5 days out
    const first = fire(state(), observed({ earningsDates: [soon] }));
    expect(first.triggers).toContain("earnings_calendar");
    expect(first.nextState.lastEarningsSeen).toBe(soon);

    // Next week's run, same date, now 2 days out. Already spoken about.
    const second = fire(state(first.nextState), observed({ earningsDates: [soon] }), "2026-09-03");
    expect(second.triggers).toEqual([]);
  });

  it("stays quiet for a date beyond the window", () => {
    const far = "2026-10-23"; // 53 days out
    const result = fire(state(), observed({ earningsDates: [far] }));
    expect(result.triggers).toEqual([]);
    // Still tracked, so we can tell when it passes.
    expect(result.nextState.nextEarningsDate).toBe(far);
    expect(result.nextState.lastEarningsSeen).toBeNull();
    expect(daysBetween(TODAY, far)).toBeGreaterThan(EARNINGS_WINDOW_DAYS);
  });

  it("fires when the date it was tracking has been and gone", () => {
    const result = fire(
      state({ nextEarningsDate: "2026-08-20", lastEarningsSeen: "2026-08-20" }),
      observed({ earningsDates: ["2026-11-19"] }),
    );
    expect(result.triggers).toContain("earnings_calendar");
    expect(result.passedEarnings).toBe("2026-08-20");
  });

  it("reports a passed date exactly once, not every week thereafter", () => {
    // The expensive failure mode: a quarter that ended in August costing a
    // model call every single week until the next date is published.
    const stale = "2026-08-20";
    const first = fire(
      state({ nextEarningsDate: stale, lastEarningsSeen: stale }),
      observed({ earningsDates: [stale] }),
    );
    expect(first.passedEarnings).toBe(stale);
    expect(first.triggers).toContain("earnings_calendar");

    // The state advanced, so next week there is nothing left to report.
    const second = fire(
      state(first.nextState),
      observed({ earningsDates: [stale] }),
      "2026-09-07",
    );
    expect(second.triggers).toEqual([]);
    expect(second.passedEarnings).toBeNull();
  });

  it("treats today's earnings date as upcoming, not passed", () => {
    const result = fire(state(), observed({ earningsDates: [TODAY] }));
    expect(result.upcomingEarnings).toBe(TODAY);
    expect(result.passedEarnings).toBeNull();
  });

  it("picks the soonest date still ahead when several are listed", () => {
    const result = fire(
      state(),
      observed({ earningsDates: ["2026-05-01", "2026-09-04", "2026-12-01"] }),
    );
    expect(result.upcomingEarnings).toBe("2026-09-04");
  });
});

describe("detectTriggers — flaky provider data", () => {
  it("keeps a baseline metric Yahoo temporarily stopped reporting", () => {
    // Replacing the baseline wholesale would erase the old value, so when the
    // metric came back there would be nothing to compare it against — the
    // watch would go quietest exactly when the data got flaky.
    const first = fire(
      state({ fundamentals: { trailingPE: 20, profitMargins: 0.2 } }),
      observed({ fundamentals: { trailingPE: 21 } }),
    );
    expect(first.nextState.fundamentals).toEqual({ trailingPE: 21, profitMargins: 0.2 });

    // And the preserved baseline still detects a real move when it returns.
    const second = fire(
      state(first.nextState),
      observed({ fundamentals: { trailingPE: 21, profitMargins: 0.1 } }),
    );
    expect(second.triggers).toContain("fundamentals_delta");
  });

  it("keeps tracking a future earnings date Yahoo stopped reporting", () => {
    // Dropping it would mean the "it has been and gone" trigger could never
    // fire for that date.
    const tracked = "2026-09-20";
    const result = fire(state({ nextEarningsDate: tracked }), observed({ earningsDates: [] }));
    expect(result.nextState.nextEarningsDate).toBe(tracked);

    // ...and it still fires once the day arrives.
    const later = fire(state(result.nextState), observed({ earningsDates: [] }), "2026-09-21");
    expect(later.passedEarnings).toBe(tracked);
    expect(later.nextState.nextEarningsDate).toBeNull();
  });
});

describe("detectTriggers — the first run", () => {
  it("fires nothing but records a baseline", () => {
    // There is no previous snapshot to diff against, so every metric would
    // otherwise look like it had "appeared". The initial read is triggered by
    // the import having queued it, not by this.
    const result = fire(state(), observed({ fundamentals: { trailingPE: 20, profitMargins: 0.2 } }));
    expect(result.triggers).toEqual([]);
    expect(result.nextState.fundamentals).toEqual({ trailingPE: 20, profitMargins: 0.2 });
  });
});

describe("parseHoldingRead", () => {
  const fenced = (o: unknown) => "prose\n\n```json\n" + JSON.stringify(o) + "\n```";

  it("degrades a thin field without losing the read", () => {
    const parsed = parseHoldingRead(
      fenced({
        headline: "Nothing material.",
        still_intact: "maybe",
        what_changed: "Nothing.",
        what_to_watch: "Earnings.",
        lean: "NONSENSE",
        grounded_in: "not an array",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.headline).toBe("Nothing material.");
    expect(parsed.data.still_intact).toBeNull();
    // An unparseable lean must not become STAY — the trader would read a
    // recommendation the model never made.
    expect(parsed.data.lean).toBe("UNCLEAR");
    expect(parsed.data.grounded_in).toEqual([]);
  });

  it("reports a missing block rather than throwing", () => {
    const parsed = parseHoldingRead("no json here");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/No valid/);
  });
});

describe("the Feed row", () => {
  it("reserves red for a lean to get out", () => {
    expect(signalPriority("EXIT")).toBe("red");
    expect(signalPriority("TRIM")).toBe("amber");
    expect(signalPriority("STAY")).toBe("blue");
    expect(signalPriority("UNCLEAR")).toBe("blue");
  });

  it("names what actually happened, not a generic alert", () => {
    expect(
      signalHeadline({
        ticker: "INFY",
        lean: "TRIM",
        passedEarnings: "2026-08-20",
        upcomingEarnings: null,
        changes: [
          { key: "trailingPE", label: "Trailing P/E", previous: 20, current: 30, percentChange: 50 },
        ],
      }),
    ).toBe("INFY: earnings date 2026-08-20 has passed, trailing p/e moved — Jarvis leans TRIM");
  });

  it("never claims a report was published, only that a date passed", () => {
    // The Feed and the digest are where a claim travels furthest from its
    // evidence. All this app knows is that a calendar date is behind us — it
    // has no filing, no transcript and no idea what was said.
    const headline = signalHeadline({
      ticker: "INFY",
      lean: "STAY",
      passedEarnings: "2026-08-20",
      upcomingEarnings: null,
      changes: [],
    });
    expect(headline).not.toMatch(/reported/);
    expect(headline).toContain("has passed");
  });

  it("marks an estimated earnings date as estimated", () => {
    // Yahoo projects dates. Printing a projection as a fixture is the same
    // class of claim the whole feature refuses to make.
    expect(
      signalHeadline({
        ticker: "TCS",
        lean: "STAY",
        passedEarnings: null,
        upcomingEarnings: "2026-09-04",
        earningsDateIsEstimate: true,
        changes: [],
      }),
    ).toContain("2026-09-04 (estimated)");
  });

  it("counts multiple movers rather than listing them all", () => {
    const headline = signalHeadline({
      ticker: "TCS",
      lean: "STAY",
      passedEarnings: null,
      upcomingEarnings: "2026-09-04",
      changes: [
        { key: "a", label: "A", previous: 1, current: 2, percentChange: 100 },
        { key: "b", label: "B", previous: 1, current: 2, percentChange: 100 },
      ],
    });
    expect(headline).toBe("TCS: earnings date 2026-09-04, 2 fundamentals moved — Jarvis leans STAY");
  });
});
