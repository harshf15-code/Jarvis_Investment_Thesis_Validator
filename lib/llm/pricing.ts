/**
 * Fallback prices, in USD per million tokens, used ONLY when OpenRouter did not
 * report a cost for a call (see `lib/llm/meter.ts`).
 *
 * This map will drift — model prices change and this file will not notice. That
 * is why a row priced from it is stamped `cost_source: "estimated"` and shown as
 * an estimate in the UI. The reported number is always preferred; this exists so
 * that a call whose cost went missing still lands in the ledger as a plausible
 * non-zero amount rather than as free.
 */
export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

const PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-sonnet-4.5": { inputPerMTok: 3, outputPerMTok: 15 },
  "anthropic/claude-opus-4.1": { inputPerMTok: 15, outputPerMTok: 75 },
  "anthropic/claude-haiku-4.5": { inputPerMTok: 1, outputPerMTok: 5 },
  "openai/gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
  "google/gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
};

/**
 * Deliberately NOT free. An unknown model that fell back to zero would make a
 * loop of calls against it cost nothing and pass every budget check — the exact
 * hole this whole feature exists to close. Sonnet-class pricing is the safer
 * guess: over-charging an unknown model trips the cap early, which is a
 * complaint; under-charging it is an unbounded bill.
 */
const UNKNOWN_MODEL_PRICE: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15 };

export function priceFor(modelId: string): ModelPrice {
  return PRICES[modelId] ?? UNKNOWN_MODEL_PRICE;
}

export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceFor(modelId);
  const cost =
    (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
  // Matches numeric(12,6) in 0018 — anything finer than a millionth of a dollar
  // is noise the column cannot store anyway.
  return Math.round(cost * 1e6) / 1e6;
}
