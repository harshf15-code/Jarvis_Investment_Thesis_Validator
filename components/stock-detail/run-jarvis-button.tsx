"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Triggers `POST /api/jarvis/run` for one stock and, on success, calls
 * `router.refresh()` so the parent server component re-fetches the newly
 * written `jarvis_analyses` row. A run takes 10-30s (a live LLM call), so
 * this shows an inline loading state for the duration rather than
 * navigating away, and on failure shows an inline error (styled per the
 * design system's error state, same pattern as
 * `components/add-ticker/add-ticker-form.tsx`) without navigating.
 *
 * IMPORTANT: this is a client component. It only ever talks to
 * `POST /api/jarvis/run` over `fetch`; it must never import
 * `lib/llm/openrouter.ts` or reference `OPENROUTER_API_KEY` (that key is
 * server-only and is not exposed to the client bundle).
 */
export function RunJarvisButton({ stockId }: { stockId: string }) {
  const router = useRouter();

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setIsRunning(true);

    try {
      const response = await fetch("/api/jarvis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" && payload.error) ||
          "Something went wrong. Please try again.";
        setError(message);
        return;
      }

      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isRunning}
        className={cn(
          "h-11 rounded-xl bg-gradient-to-br from-primary to-primary-container px-6 text-sm font-medium text-on-primary transition-opacity disabled:opacity-60",
        )}
      >
        {isRunning ? "Running Jarvis…" : "Run Jarvis"}
      </button>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-error-container/10 px-3 py-2 text-sm text-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
