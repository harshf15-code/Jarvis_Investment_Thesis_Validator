import { describe, expect, it } from "vitest";

import {
  normalizeCandidateRanks,
  parseCandidateAnalysis,
  parseCandidateShortlist,
  parseTradePlanDraft,
  sanitizeTradePlanDraft,
  type TradePlanDraft,
} from "@/lib/jarvis-thesis-parser";

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
    const result = parseCandidateShortlist("I could not find any candidates.");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty candidate list rather than returning zero names", () => {
    expect(parseCandidateShortlist(fence({ candidates: [] })).ok).toBe(false);
  });
});

describe("parseCandidateAnalysis", () => {
  it("rejects a verdict outside the enum", () => {
    const result = parseCandidateAnalysis(
      fence({
        candidates: [
          { ticker: "X", rank: 1, verdict: "strong_buy", score: 80, fit_rationale: null, bull_case: null, bear_case: null },
        ],
        comparative_verdict: null,
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("normalizeCandidateRanks", () => {
  const base = { fit_rationale: null, bull_case: null, bear_case: null };

  it("re-derives ranks from score, highest first", () => {
    const out = normalizeCandidateRanks([
      { ticker: "A", rank: 1, verdict: "bet", score: 40, ...base },
      { ticker: "B", rank: 2, verdict: "watch", score: 90, ...base },
      { ticker: "C", rank: 3, verdict: "avoid", score: 60, ...base },
    ]);
    expect(out.map((c) => c.ticker)).toEqual(["B", "C", "A"]);
    expect(out.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it("demotes a duplicate winner to watch", () => {
    const out = normalizeCandidateRanks([
      { ticker: "A", rank: 1, verdict: "bet", score: 90, ...base },
      { ticker: "B", rank: 2, verdict: "bet", score: 70, ...base },
    ]);
    expect(out[0].verdict).toBe("bet");
    expect(out[1].verdict).toBe("watch");
  });

  it("never promotes: a top-scoring 'watch' stays a watch", () => {
    const out = normalizeCandidateRanks([
      { ticker: "A", rank: 2, verdict: "watch", score: 45, ...base },
      { ticker: "B", rank: 1, verdict: "avoid", score: 30, ...base },
    ]);
    expect(out[0].verdict).toBe("watch");
  });

  it("breaks a score tie with the model's own rank", () => {
    const out = normalizeCandidateRanks([
      { ticker: "A", rank: 2, verdict: "watch", score: 70, ...base },
      { ticker: "B", rank: 1, verdict: "bet", score: 70, ...base },
    ]);
    expect(out.map((c) => c.ticker)).toEqual(["B", "A"]);
  });
});

describe("sanitizeTradePlanDraft", () => {
  const draft = (over: Partial<TradePlanDraft>): TradePlanDraft => ({
    entry_zone_low: 100,
    entry_zone_high: 110,
    add_tranche_low: 90,
    add_tranche_high: 95,
    stop_loss: 85,
    target_1: 130,
    target_2: 150,
    position_size_pct: 5,
    time_exit_date: "2026-12-31",
    time_exit_condition: "EV share > 15%",
    notes: null,
    ...over,
  });

  it("leaves a coherent plan untouched", () => {
    const input = draft({});
    expect(sanitizeTradePlanDraft(input)).toEqual(input);
  });

  it("drops a stop that sits at or above the add tranche", () => {
    expect(sanitizeTradePlanDraft(draft({ stop_loss: 95 })).stop_loss).toBeNull();
  });

  it("falls back to the entry zone as the stop's floor when there is no add tranche", () => {
    const out = sanitizeTradePlanDraft(
      draft({ add_tranche_low: null, add_tranche_high: null, stop_loss: 105 }),
    );
    expect(out.stop_loss).toBeNull();
  });

  it("drops a target that is not above the entry zone", () => {
    expect(sanitizeTradePlanDraft(draft({ target_1: 105 })).target_1).toBeNull();
  });

  it("drops target_2 when it is not above target_1", () => {
    expect(sanitizeTradePlanDraft(draft({ target_2: 120 })).target_2).toBeNull();
  });

  it("swaps a reversed entry zone instead of discarding both bounds", () => {
    const out = sanitizeTradePlanDraft(draft({ entry_zone_low: 110, entry_zone_high: 100 }));
    expect(out.entry_zone_low).toBe(100);
    expect(out.entry_zone_high).toBe(110);
  });

  it("drops non-positive prices", () => {
    expect(sanitizeTradePlanDraft(draft({ entry_zone_low: 0 })).entry_zone_low).toBeNull();
    expect(sanitizeTradePlanDraft(draft({ target_1: -5 })).target_1).toBeNull();
  });

  it("drops an out-of-range position size", () => {
    expect(sanitizeTradePlanDraft(draft({ position_size_pct: 140 })).position_size_pct).toBeNull();
    expect(sanitizeTradePlanDraft(draft({ position_size_pct: 0 })).position_size_pct).toBeNull();
  });

  it("drops a malformed or impossible exit date", () => {
    expect(sanitizeTradePlanDraft(draft({ time_exit_date: "next quarter" })).time_exit_date).toBeNull();
    expect(sanitizeTradePlanDraft(draft({ time_exit_date: "2026-13-01" })).time_exit_date).toBeNull();
  });
});

describe("parseTradePlanDraft", () => {
  it("coerces a bad field to null rather than discarding the whole draft", () => {
    const result = parseTradePlanDraft(
      fence({
        entry_zone_low: 100,
        entry_zone_high: 110,
        add_tranche_low: null,
        add_tranche_high: null,
        stop_loss: "not a number",
        target_1: 130,
        target_2: null,
        position_size_pct: 4,
        time_exit_date: null,
        time_exit_condition: null,
        notes: null,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.stop_loss).toBeNull();
      expect(result.data.entry_zone_low).toBe(100);
    }
  });
});
