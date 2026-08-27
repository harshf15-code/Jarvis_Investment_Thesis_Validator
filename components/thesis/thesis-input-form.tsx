"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConvictionBadge } from "./conviction-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { ConvictionTier, ThesisMode } from "@/lib/types";

type ThesisResult = {
  thesis: {
    id: string;
    mode: ThesisMode;
    ticker: string | null;
    market_view: string | null;
    mispricing: string | null;
    catalyst: string | null;
    time_horizon: string | null;
    invalidation_condition: string | null;
    conviction_tier: ConvictionTier | null;
    conviction_score: number | null;
  };
  stockSuggestions: { ticker: string; rationale: string }[];
  duplicateWarning: { existingThesisId: string; status: string; createdAt: string } | null;
};

const FIELD_LABELS: { key: keyof ThesisResult["thesis"]; label: string }[] = [
  { key: "market_view", label: "Market View" },
  { key: "mispricing", label: "Mispricing" },
  { key: "catalyst", label: "Catalyst" },
  { key: "time_horizon", label: "Time Horizon" },
  { key: "invalidation_condition", label: "Invalidation" },
];

/**
 * Screen 1 (spec US-09/US-10). Single free-text input, no dropdowns, no
 * mandatory fields — mode is entirely inferred server-side by Task 9's
 * route. Used both as the always-available drawer content (Task 6) and as
 * its own page (`app/(app)/thesis/new/page.tsx`).
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
  const [result, setResult] = useState<ThesisResult | null>(null);

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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Jarvis is thinking... Taking longer than usual.");
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!result) return;
    await fetch(`/api/theses/${result.thesis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    onSaved?.(result.thesis.id);
    router.push(`/thesis/${result.thesis.id}/plan`);
  }

  function handleSaveDraft() {
    if (!result) return;
    onSaved?.(result.thesis.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Tell Jarvis your thesis. Stock name, market view, or both — however you'd say it."
          rows={4}
          className="w-full resize-none rounded-xl bg-surface-container-highest px-4 py-3 font-sans text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !inputText.trim()}
          className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "Jarvis is thinking..." : "Send to Jarvis"}
        </button>
      </div>

      {loading && <SkeletonLoader lines={5} />}

      {error && (
        <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
          {error} <button type="button" onClick={handleSubmit} className="underline">Retry</button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {result.duplicateWarning && (
            <div className="rounded-xl bg-status-blue-container px-4 py-3 text-sm text-status-blue">
              Existing thesis found for {result.thesis.ticker} (status: {result.duplicateWarning.status},{" "}
              {new Date(result.duplicateWarning.createdAt).toLocaleDateString()}).{" "}
              <a href={`/thesis/${result.duplicateWarning.existingThesisId}`} className="underline">
                View existing
              </a>{" "}
              — or create new anyway below.
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="font-display text-sm text-on-surface/60">
              {result.thesis.ticker ?? "No stock — Macro Thesis"}
            </span>
            {result.thesis.conviction_tier && <ConvictionBadge tier={result.thesis.conviction_tier} />}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className="rounded-xl bg-surface-container-low p-4">
                <p className="mb-1 font-display text-xs uppercase tracking-wide text-on-surface/50">
                  {label}
                </p>
                <p className="text-sm text-on-surface">{String(result.thesis[key] ?? "—")}</p>
              </div>
            ))}
          </div>

          {result.thesis.mode === "thesis_only" && result.stockSuggestions.length > 0 && (
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="mb-2 font-display text-sm text-on-surface">
                Jarvis sees these names as potential expressions of this thesis:
              </p>
              <div className="flex flex-col gap-2">
                {result.stockSuggestions.map((s) => (
                  <button
                    key={s.ticker}
                    type="button"
                    onClick={() => setInputText(`${s.ticker} — ${result.thesis.market_view}`)}
                    className="rounded-lg bg-surface-container-highest px-3 py-2 text-left text-sm hover:bg-primary/10"
                  >
                    <span className="font-medium text-primary">{s.ticker}</span>{" "}
                    <span className="text-on-surface/70">{s.rationale}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="rounded-xl bg-surface-container-highest px-4 py-2 text-sm font-medium text-on-surface/80 hover:text-on-surface"
            >
              Save as Draft
            </button>
            <button
              type="button"
              onClick={handleApprove}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
            >
              Approve → Build Trade Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
