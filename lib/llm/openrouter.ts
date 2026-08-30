import { createOpenAI } from "@ai-sdk/openai";

/**
 * OpenRouter provider, wired through `@ai-sdk/openai`'s `createOpenAI`
 * since OpenRouter exposes an OpenAI-chat-completions-compatible API at a
 * custom base URL (verified against the installed `@ai-sdk/openai@3.0.102`
 * / `ai@6.0.268` types: `OpenAIProviderSettings` accepts `baseURL`/`apiKey`,
 * and the returned `OpenAIProvider` is itself callable as
 * `(modelId) => LanguageModelV3`, matching Task 8's brief exactly).
 *
 * THIS IS THE ONLY MODULE IN THE APP ALLOWED TO REFERENCE
 * `OPENROUTER_API_KEY`. It is a server-only secret (no `NEXT_PUBLIC_`
 * prefix) and must never be imported, directly or transitively, from a
 * `"use client"` file.
 *
 * The model itself is NOT exported. Every call goes through
 * `lib/llm/meter.ts`, so a new call site cannot spend money without recording
 * it — the same reasoning as enforcing the thesis-mode invariant in the parser
 * rather than asking for it in the prompt.
 */

/** What OpenRouter charged for one call, keyed by its generation id. */
type Reported = { cost: number | null; model: string | null };

/**
 * Costs seen on the wire but not yet claimed by the meter.
 *
 * Bounded two ways: entries are deleted the moment they are read, and the map
 * is trimmed when it grows past `MAX_PENDING` — a response the SDK throws away
 * (a parse failure, an aborted request) would otherwise sit here forever.
 */
const reported = new Map<string, Reported>();
const MAX_PENDING = 200;

/**
 * Reads OpenRouter's own `usage.cost` off the response before the AI SDK ever
 * sees it.
 *
 * This exists because the cost cannot be recovered downstream.
 * `@ai-sdk/openai` validates the response body with a plain Zod object
 * (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details`, …) and Zod
 * strips unknown keys, so `cost` is gone by the time `convertOpenAIChatUsage`
 * assigns `raw: usage`. Reading `result.usage.raw.cost` returns undefined every
 * time. The only place the number still exists is the untouched HTTP body.
 *
 * Metering must never break a call: every failure path here is swallowed and
 * costs at worst a `cost_source: "estimated"` row.
 */
const meteringFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    // `clone()` so the SDK still receives an unread body. Safe here because
    // every call in this app is a single non-streaming JSON response.
    const body = await res.clone().json();
    if (body && typeof body.id === "string") {
      if (reported.size >= MAX_PENDING) {
        // Oldest first — Map preserves insertion order.
        const oldest = reported.keys().next();
        if (!oldest.done) reported.delete(oldest.value);
      }
      reported.set(body.id, {
        cost: typeof body.usage?.cost === "number" ? body.usage.cost : null,
        model: typeof body.model === "string" ? body.model : null,
      });
    }
  } catch {
    // Not JSON, already consumed, or a shape we don't recognise. The call
    // itself is unaffected.
  }
  return res;
};

/**
 * Claims the reported cost for a generation id, removing it. Returns null when
 * the interceptor never saw it, which is the meter's cue to fall back to a
 * token-based estimate.
 */
export function takeReportedCost(generationId: string | undefined): Reported | null {
  if (!generationId) return null;
  const hit = reported.get(generationId);
  if (!hit) return null;
  reported.delete(generationId);
  return hit;
}

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  fetch: meteringFetch,
});

/** The OpenRouter model id used for every Jarvis call. */
export const JARVIS_MODEL_ID =
  process.env.OPENROUTER_MODEL_ID ?? "anthropic/claude-sonnet-4.5";

/** Internal — reachable only through `lib/llm/meter.ts`. */
export const jarvisModel = openrouter(JARVIS_MODEL_ID);
