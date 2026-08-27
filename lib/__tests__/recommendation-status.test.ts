import { describe, expect, it } from "vitest";
import { computeRecommendationStatus, computePctChangeSinceRec } from "@/lib/recommendation-status";

const base = {
  recommended_target_1: 120,
  recommended_target_2: 140,
  recommended_stop: 90,
  price_at_recommendation: 100,
};

describe("computeRecommendationStatus", () => {
  it("returns t1_hit when price has reached target_1 but not target_2", () => {
    expect(computeRecommendationStatus(base, 125)).toBe("t1_hit");
  });
  it("returns t2_hit when price has reached target_2", () => {
    expect(computeRecommendationStatus(base, 145)).toBe("t2_hit");
  });
  it("returns stop_hit when price is at or below the stop, taking precedence over targets", () => {
    expect(computeRecommendationStatus(base, 85)).toBe("stop_hit");
  });
  it("returns open when price is between entry and target_1", () => {
    expect(computeRecommendationStatus(base, 105)).toBe("open");
  });
});

describe("computePctChangeSinceRec", () => {
  it("computes percent change from price_at_recommendation", () => {
    expect(computePctChangeSinceRec(base, 110)).toBe(10);
    expect(computePctChangeSinceRec(base, 90)).toBe(-10);
  });
});
