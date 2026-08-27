import type { RecommendationStatus } from "@/lib/types";

type RecFields = {
  recommended_target_1: number | null;
  recommended_target_2: number | null;
  recommended_stop: number | null;
  price_at_recommendation: number;
};

/**
 * Recomputed on every page load (spec US-22) — never stored, never
 * cron-updated. Precedence: stop takes priority over any target (a
 * recommendation that later also crossed a target after stopping out is
 * still, correctly, a loss).
 */
export function computeRecommendationStatus(
  rec: RecFields,
  currentPrice: number,
): RecommendationStatus {
  if (rec.recommended_stop !== null && currentPrice <= rec.recommended_stop) {
    return "stop_hit";
  }
  if (rec.recommended_target_2 !== null && currentPrice >= rec.recommended_target_2) {
    return "t2_hit";
  }
  if (rec.recommended_target_1 !== null && currentPrice >= rec.recommended_target_1) {
    return "t1_hit";
  }
  return "open";
}

export function computePctChangeSinceRec(rec: RecFields, currentPrice: number): number {
  return ((currentPrice - rec.price_at_recommendation) / rec.price_at_recommendation) * 100;
}
