"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, SendHorizontal } from "lucide-react";

import { CandidateBakeoff } from "./candidate-bakeoff";
import { ConvictionBadge } from "./conviction-badge";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { ConvictionTier, ThesisCandidate, ThesisMode } from "@/lib/types";

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

const FIELD_LABELS: { key: keyof ThesisResult["thesis"]; label: string; tone?: "error" }[] = [
  { key: "market_view", label: "Market View" },
  { key: "mispricing", label: "Mispricing" },
  { key: "catalyst", label: "Catalyst" },
  { key: "time_horizon", label: "Time Horizon" },
  { key: "invalidation_condition", label: "Invalidation", tone: "error" },
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
  const [backedTicker, setBackedTicker] = useState<string | null>(null);

  async function handleSubmit() {
    if (!inputText.trim()) return;
    setLoading(true);
    setError(null);
    setBackedTicker(null);
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

  // A macro thesis has no instrument until the bake-off resolves to one, and a
  // trade plan without an instrument has no price to quote entries and stops
  // against — so the CTA stays blocked rather than landing on a dead plan page.
  const isMacro = result?.thesis.mode === "thesis_only";
  const instrument = backedTicker ?? result?.thesis.ticker ?? null;
  const canBuildPlan = !isMacro || instrument !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-3 font-display text-sm font-extrabold tracking-tight text-primary">
          Thesis Engine
        </h2>
        <div className="relative">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Tell Jarvis your thesis. A stock, a market view, or both — however you'd say it."
            rows={4}
            className="sunken w-full resize-none rounded-lg p-4 pr-16 text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
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
          <p className="mt-2 text-xs text-on-surface-variant">Jarvis is thinking…</p>
        )}
      </div>

      {loading && <SkeletonLoader lines={5} />}

      {error && (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
          {error}{" "}
          <button type="button" onClick={handleSubmit} className="underline">
            Retry
          </button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {result.duplicateWarning && (
            <div className="rounded-lg bg-status-blue-container px-4 py-3 text-sm text-status-blue">
              Existing thesis found for {result.thesis.ticker} (status:{" "}
              {result.duplicateWarning.status},{" "}
              {new Date(result.duplicateWarning.createdAt).toLocaleDateString()}).{" "}
              <a href={`/thesis/${result.duplicateWarning.existingThesisId}`} className="underline">
                View existing
              </a>{" "}
              — or create new anyway below.
            </div>
          )}

          <section className="glass-panel overflow-hidden rounded-lg">
            <div className="flex items-center justify-between gap-3 p-5">
              <span className="font-display text-base font-extrabold tracking-tight text-on-surface">
                {instrument ?? "Macro Thesis — no stock named"}
              </span>
              <div className="flex items-center gap-3">
                {result.thesis.conviction_score !== null && (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    CONVICTION: {Math.round(result.thesis.conviction_score)}%
                  </span>
                )}
                {result.thesis.conviction_tier && (
                  <ConvictionBadge tier={result.thesis.conviction_tier} />
                )}
              </div>
            </div>

            <div className="grid gap-px bg-white/5 sm:grid-cols-2">
              {FIELD_LABELS.map(({ key, label, tone }) => (
                <div key={key} className="bg-surface-container/40 p-5">
                  <p
                    className={`mb-2 text-[10px] font-extrabold uppercase tracking-widest ${
                      tone === "error" ? "text-error" : "text-on-surface-variant/70"
                    }`}
                  >
                    {label}
                  </p>
                  <p className="text-sm leading-relaxed text-on-surface">
                    {String(result.thesis[key] ?? "—")}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {isMacro && (
            <CandidateBakeoff
              thesisId={result.thesis.id}
              onPicked={(c: ThesisCandidate) => setBackedTicker(c.ticker)}
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="rounded-full bg-white/5 px-5 py-2.5 text-sm font-bold tracking-tight text-on-surface/80 transition-colors hover:bg-white/10 hover:text-on-surface"
            >
              Save as Draft
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={!canBuildPlan}
              title={
                canBuildPlan ? undefined : "Back one of the candidates above to build a trade plan."
              }
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
            >
              {instrument ? `Build Trade Plan — ${instrument}` : "Build Trade Plan"}
              <ArrowRight className="size-4" strokeWidth={2.5} />
            </button>
            {!canBuildPlan && (
              <span className="text-xs text-on-surface-variant">
                Back a candidate above first — a trade plan needs an instrument to price.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
