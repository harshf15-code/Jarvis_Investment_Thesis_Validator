import { generateText } from "ai";

import {
  JARVIS_MODEL_ID,
  jarvisModel,
  takeMostRecentUnclaimed,
  takeReportedCost,
} from "@/lib/llm/openrouter";
import { estimateCostUsd } from "@/lib/llm/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LlmFeature, LlmUsageInsert } from "@/lib/types";

/**
 * The single door to the model. Every `generateText` in this app goes through
 * here, and `jarvisModel` exists only for this file to use.
 *
 * Its job is to make spending money and recording it the same action, so the
 * two cannot drift. Cost is taken from OpenRouter's own reported charge where
 * possible (see `takeReportedCost`), because token prices change per model and
 * a token count is not a bill.
 *
 * Writes go through the SERVICE-ROLE client. `authenticated` has SELECT and
 * nothing else on `llm_usage` (0018), because a ledger its subject can delete
 * is not a limit — it is a limit the user controls.
 */
export type MeteredCall = {
  userId: string;
  feature: LlmFeature;
  system: string;
  prompt: string;
  /** Attributes spend to a thesis where there is one, for per-thesis cost. */
  thesisId?: string | null;
};

async function record(row: LlmUsageInsert): Promise<void> {
  try {
    const { error } = await createAdminClient().from("llm_usage").insert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    // Deliberately swallowed. The money is already spent; failing the request
    // now would lose the memorandum the user paid for in order to record that
    // they paid for it. Loud, because unrecorded spend is invisible spend.
    console.error(
      `[llm-meter] FAILED TO RECORD SPEND for user=${row.user_id} feature=${row.feature}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Runs one model call and books it.
 *
 * A thrown call is still recorded, with `ok: false` and whatever cost was
 * reported before it failed. Upstream can bill for a call that never produced a
 * usable answer, and an unrecorded call is worse than a recorded zero — it is a
 * hole in the very number the budget check reads.
 */
export async function meteredGenerateText({
  userId,
  feature,
  system,
  prompt,
  thesisId = null,
}: MeteredCall) {
  // Two jobs: the window `takeMostRecentUnclaimed` searches for a charge the
  // SDK threw away, and — since 0026 — the start of the duration this books.
  // The app spent its first year able to say what a call cost and unable to say
  // how long it took, which is the number you actually want when a function
  // ceiling turns out to be too low.
  const startedAt = Date.now();
  try {
    const result = await generateText({ model: jarvisModel, system, prompt });

    const generationId = result.response?.id;
    const hit = takeReportedCost(generationId);
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const model = hit?.model ?? JARVIS_MODEL_ID;

    // Reported wins. The estimate is a floor under missing data, not a
    // preference — and it is labelled, so a drifting price map surfaces as
    // visibly estimated money rather than as quietly wrong money.
    const reportedCost = hit?.cost ?? null;
    const cost =
      reportedCost !== null
        ? reportedCost
        : estimateCostUsd(model, inputTokens, outputTokens);

    await record({
      user_id: userId,
      feature,
      model,
      generation_id: generationId ?? null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: cost,
      cost_source: reportedCost !== null ? "reported" : "estimated",
      thesis_id: thesisId,
      ok: true,
      duration_ms: Date.now() - startedAt,
    });

    return result;
  } catch (err) {
    // A throw does not mean a free call. OpenRouter can return a fully billable
    // response that the SDK then rejects, in which case the charge was already
    // captured on the wire and is claimed here — otherwise a repeatable
    // validation failure would book $0 forever and never reach the cap.
    const late = takeMostRecentUnclaimed(startedAt);
    await record({
      user_id: userId,
      feature,
      model: late?.model ?? JARVIS_MODEL_ID,
      cost_usd: late?.cost ?? 0,
      cost_source: late?.cost != null ? "reported" : "estimated",
      thesis_id: thesisId,
      ok: false,
      // Measured on the failure path too. A call that took 58s and then threw
      // is the most interesting row in the table for anyone asking whether a
      // route's ceiling is set anywhere near reality.
      duration_ms: Date.now() - startedAt,
    });
    throw err;
  }
}
