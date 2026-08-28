"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SendHorizontal } from "lucide-react";

import { SkeletonLoader } from "@/components/shared/skeleton-loader";

/**
 * Screen 1 (spec US-09/US-10). Single free-text input, no dropdowns, no
 * mandatory fields — mode is entirely inferred server-side by Task 9's route.
 * Used both as the always-available drawer content (Task 6) and as its own page
 * (`app/(app)/thesis/new/page.tsx`).
 *
 * Structuring the thesis is now only the first half of one request: the form
 * hands straight off to the memorandum, which runs the comparison and produces
 * the full document. It no longer renders the six fields itself — showing a
 * summary here and the same fields again on the memo made the user read the
 * thesis twice before seeing any analysis.
 */
export function ThesisInputForm({
  prefillTicker,
  onSaved,
}: {
  prefillTicker?: string;
  onSaved?: (thesisId: string) => void;
}) {
  const router = useRouter();
  const [inputText, setInputText] = useState(prefillTicker ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!inputText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/theses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_text: inputText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Jarvis is thinking... Taking longer than usual.");
      }
      onSaved?.(body.thesis.id);
      router.push(`/thesis/${body.thesis.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
          Thesis Engine
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          Name a stock, describe a market view, or both. Jarvis will pick the field, price every
          candidate, and come back with the whole call.
        </p>
      </div>

      <div className="relative">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter keeps a newline, since a thesis is
            // often a couple of sentences.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="e.g. Indian banks and NBFCs have NPAs at all-time lows — good time to be long the sector."
          rows={5}
          disabled={loading}
          className="sunken w-full resize-none rounded-lg p-4 pr-16 text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !inputText.trim()}
          aria-label="Send to Jarvis"
          className="absolute right-3 bottom-3 flex size-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-95 disabled:opacity-40 disabled:shadow-none"
        >
          <SendHorizontal className="size-4" strokeWidth={2.5} />
        </button>
      </div>

      {loading && (
        <>
          <p className="text-xs text-primary">Structuring the thesis…</p>
          <SkeletonLoader lines={4} />
        </>
      )}

      {error && (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
          {error}{" "}
          <button type="button" onClick={handleSubmit} className="underline">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
