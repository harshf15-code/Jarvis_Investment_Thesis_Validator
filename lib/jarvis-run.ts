import type {
  AlertCriteriaExtract,
  JarvisSections,
} from "@/lib/jarvis-parser";
import type { AlertCriteriaInsert, JarvisAnalysisInsert, Json } from "@/lib/types";

/**
 * Pure bookkeeping helpers for `app/api/jarvis/run/route.ts` (Task 8),
 * factored out so the versioning/row-shaping logic is unit-testable without
 * a real (or mocked) Supabase client and without a live LLM call. Every
 * actual DB side effect (the "set previous is_latest/is_active false, then
 * insert" ordering) stays in the route handler; this module only computes
 * values and row shapes from already-known inputs.
 */

/**
 * Next `jarvis_analyses.version` for a stock: one more than the highest
 * existing version for that stock, or `1` if none exist yet.
 */
export function computeNextVersion(existingVersions: number[]): number {
  if (existingVersions.length === 0) {
    return 1;
  }
  return Math.max(...existingVersions) + 1;
}

/**
 * Builds the `jarvis_analyses` insert row from the parsed narrative
 * sections plus already-fetched context. `is_latest: true` and
 * `extraction_ok` are pure derivations of the inputs here — the caller
 * (the route) is responsible for the DB side effect of flipping any
 * *previous* `is_latest` row to `false` first, before issuing this insert.
 *
 * Column-mapping note: `JarvisSections` (Task 7 / `lib/jarvis-parser.ts`)
 * carries FIVE narrative sections (thesis, stressTest, tradePlan,
 * riskAwareness, exitDiscipline), but the `jarvis_analyses` table
 * (`supabase/migrations/0001_init.sql`) has only FOUR `*_json` narrative
 * columns — there is no `risk_awareness_json`. Rather than silently
 * dropping the "Risk Awareness" section (STEP 4 of `JARVIS_SYSTEM_PROMPT`:
 * whether the trade should be rejected — no stop loss, unclear thesis,
 * emotional reasoning), it is folded into `exit_json`, prepended ahead of
 * "Exit Discipline" (STEP 5): both are the trade's final risk/action gate,
 * and this preserves the full narrative text without requiring a schema
 * change outside this task's scope. See task-8-report.md for the full
 * rationale.
 */
export function buildJarvisAnalysisInsert(input: {
  stockId: string;
  version: number;
  extractionOk: boolean;
  sections: JarvisSections;
  rawResponse: string;
  modelId: string;
  inputContext: Json;
}): JarvisAnalysisInsert {
  const exitNarrative = [input.sections.riskAwareness, input.sections.exitDiscipline]
    .filter((text) => text.length > 0)
    .join("\n\n");

  return {
    stock_id: input.stockId,
    version: input.version,
    is_latest: true,
    extraction_ok: input.extractionOk,
    thesis_json: { narrative: input.sections.thesis },
    stress_test_json: { narrative: input.sections.stressTest },
    trade_plan_json: { narrative: input.sections.tradePlan },
    exit_json: { narrative: exitNarrative },
    raw_llm_response: input.rawResponse,
    model_id: input.modelId,
    input_context_json: input.inputContext,
  };
}

/**
 * Builds the `alert_criteria` insert row from a successful extraction. Only
 * ever called when `extraction.ok` — the route skips `alert_criteria`
 * bookkeeping entirely on a failed extraction, so the previous active row
 * (if any) stays active and monitoring doesn't go dark over one bad re-run.
 */
export function buildAlertCriteriaInsert(input: {
  stockId: string;
  jarvisAnalysisId: string;
  data: AlertCriteriaExtract;
}): AlertCriteriaInsert {
  const { data } = input;
  return {
    stock_id: input.stockId,
    jarvis_analysis_id: input.jarvisAnalysisId,
    is_active: true,
    entry_low: data.entry_zone.low,
    entry_high: data.entry_zone.high,
    stop_loss: data.stop_loss,
    trim_targets: data.trim_targets as unknown as Json,
    time_exit_date: data.time_exit_date,
    reassessment_date: data.reassessment_date,
    earnings_date: data.earnings_date,
    invalidation_text: data.invalidation_condition,
  };
}
