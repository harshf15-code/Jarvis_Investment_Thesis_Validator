"use client";

import { useState } from "react";
import type { BearCase } from "@/lib/types";

/**
 * Spec Screen 2-3 Step 2 (US-11): left column = bear cases, right column = counters,
 * horizontally paired.
 *
 * The spec says the conviction score "updates as the user modifies counter-arguments"
 * but defines no scoring rubric anywhere, so the score is a directly user-editable
 * slider seeded from Screen 1's AI-generated value rather than a made-up formula —
 * the user is the one who re-scores conviction after reading the bear cases.
 */
export function StressTestPanel({
  thesisId,
  bearCases,
  convictionScore,
  onApproved,
}: {
  thesisId: string;
  bearCases: BearCase[];
  convictionScore: number | null;
  onApproved: () => void;
}) {
  const [cases, setCases] = useState(bearCases);
  const [score, setScore] = useState(convictionScore ?? 50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateCounter(index: number, counter: string) {
    setCases((prev) => prev.map((c, i) => (i === index ? { ...c, counter, modified: true } : c)));
  }

  async function patchThesis(body: Record<string, unknown>) {
    const res = await fetch(`/api/theses/${thesisId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error ?? "Failed to save.");
    }
  }

  /** Auto-save on release only — `onPointerUp` covers mouse and touch, `onKeyUp` the arrow keys. */
  async function handleScoreCommit() {
    try {
      await patchThesis({ conviction_score: score });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save conviction score.");
    }
  }

  async function handleApprove() {
    setSaving(true);
    setError(null);
    try {
      await patchThesis({ bear_cases: cases, conviction_score: score });
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-xs uppercase tracking-wide text-on-surface/50">Step 2 of 3</p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-on-surface/60">
          <span>Conviction Score</span>
          <span className="font-mono text-primary">{score}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={score}
          aria-label="Conviction Score"
          onChange={(e) => setScore(Number(e.target.value))}
          onPointerUp={handleScoreCommit}
          onKeyUp={handleScoreCommit}
          className="w-full accent-[var(--color-primary)]"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cases.map((bc, i) => (
          <div key={i} className="contents">
            <div className="rounded-xl bg-status-red-container p-4">
              <p className="mb-1 font-display text-xs uppercase text-status-red">Bear Case {i + 1}</p>
              <p className="text-sm text-on-surface">{bc.reason}</p>
            </div>
            <div className="rounded-xl bg-status-green-container p-4">
              <div className="mb-1 flex items-center gap-2">
                <p className="font-display text-xs uppercase text-status-green">Counter</p>
                {bc.modified && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] text-primary">Modified</span>
                )}
              </div>
              <textarea
                value={bc.counter}
                aria-label={`Counter-argument for bear case ${i + 1}`}
                onChange={(e) => updateCounter(i, e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg bg-surface-container-highest px-2 py-1 text-sm text-on-surface"
              />
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-status-red">{error}</p>}

      <button
        type="button"
        onClick={handleApprove}
        disabled={saving}
        className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Stress Test Approved → Build Trade Plan
      </button>
    </div>
  );
}
