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
 * `"use client"` file. Its importers are all server-only Route Handlers:
 * `app/api/theses/route.ts`, `app/api/theses/[id]/memorandum/route.ts` and
 * `app/api/journal/route.ts`.
 */
export const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

/** The OpenRouter model id used for every Jarvis call. */
export const JARVIS_MODEL_ID =
  process.env.OPENROUTER_MODEL_ID ?? "anthropic/claude-sonnet-4.5";

export const jarvisModel = openrouter(JARVIS_MODEL_ID);
