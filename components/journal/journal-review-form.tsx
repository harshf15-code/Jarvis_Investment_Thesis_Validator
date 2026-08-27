"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { StarRating } from "./star-rating";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { ThesisOutcome } from "@/lib/types";

type AutoFilled = {
  ticker: string;
  entryDates: string[];
  exitDates: string[];
  pnlRupees: number;
  pnlPct: number;
  convictionTier: string | null;
};

const OUTCOME_OPTIONS: ThesisOutcome[] = ["confirmed", "partially_confirmed", "invalidated"];

/** Spec Screen 7 (US-18). Two-phase: generate a Jarvis verdict preview first (editable), then persist. */
export function JournalReviewForm({ positionId }: { positionId: string }) {
  const router = useRouter();
  const [autoFilled, setAutoFilled] = useState<AutoFilled | null>(null);
  const [verdict, setVerdict] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ThesisOutcome>("confirmed");
  const [ratings, setRatings] = useState({ entry_quality: 3, sizing_quality: 3, stop_management: 3, exit_quality: 3, discipline_score: 3 });
  const [text, setText] = useState({ what_went_right: "", what_went_wrong: "", lessons: "" });
  const [editingVerdict, setEditingVerdict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position_id: positionId, generate_only: true }),
    })
      .then((res) => res.json())
      .then((body) => {
        setAutoFilled(body.autoFilled);
        setVerdict(body.verdict ?? "");
        setTags(body.suggestedTags ?? []);
        setLoading(false);
      });
  }, [positionId]);

  async function handleSave() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position_id: positionId,
          thesis_outcome: outcome,
          ...ratings,
          ...text,
          jarvis_verdict: verdict || null,
          tags,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save review");
      router.push("/journal");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !autoFilled) return <SkeletonLoader lines={6} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="font-display text-lg text-on-surface">{autoFilled.ticker}</p>
        <p className="mt-1 text-xs text-on-surface/60">
          Entry {autoFilled.entryDates.join(", ")} · Exit {autoFilled.exitDates.join(", ")} · Tier {autoFilled.convictionTier ?? "—"}
        </p>
        <p className={`mt-2 font-mono text-lg ${autoFilled.pnlRupees >= 0 ? "text-status-green" : "text-status-red"}`}>
          {autoFilled.pnlRupees >= 0 ? "+" : ""}
          {autoFilled.pnlRupees.toFixed(2)} ({autoFilled.pnlPct.toFixed(2)}%)
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-on-surface/50">Thesis Outcome</span>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as ThesisOutcome)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o} value={o}>{o.replace("_", " ")}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-4">
        <StarRating label="Entry Quality" value={ratings.entry_quality} onChange={(v) => setRatings((r) => ({ ...r, entry_quality: v }))} />
        <StarRating label="Sizing" value={ratings.sizing_quality} onChange={(v) => setRatings((r) => ({ ...r, sizing_quality: v }))} />
        <StarRating label="Stop Management" value={ratings.stop_management} onChange={(v) => setRatings((r) => ({ ...r, stop_management: v }))} />
        <StarRating label="Exit Timing" value={ratings.exit_quality} onChange={(v) => setRatings((r) => ({ ...r, exit_quality: v }))} />
        <StarRating label="Overall Discipline" value={ratings.discipline_score} onChange={(v) => setRatings((r) => ({ ...r, discipline_score: v }))} />
      </div>

      {(
        [
          ["what_went_right", "What went right"],
          ["what_went_wrong", "What went wrong (including: was the stop correct?)"],
          ["lessons", "Lessons / what I'd do differently"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs text-on-surface/50">{label}</span>
          <textarea
            rows={3}
            value={text[key]}
            onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
            className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm"
          />
        </label>
      ))}

      <div className="rounded-xl bg-primary-container p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-display text-xs uppercase text-primary">Jarvis Verdict</p>
          <button type="button" onClick={() => setEditingVerdict((v) => !v)} className="text-xs text-primary underline">
            {editingVerdict ? "Done" : "Edit"}
          </button>
        </div>
        {editingVerdict ? (
          <textarea value={verdict} onChange={(e) => setVerdict(e.target.value)} rows={3} className="w-full rounded-lg bg-surface-container-highest px-3 py-2 text-sm text-on-surface" />
        ) : (
          <p className="text-sm text-primary">{verdict || "—"}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={tag} className="rounded-full bg-surface-container-highest px-3 py-1 text-xs text-on-surface/70">{tag}</span>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={submitting}
        className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
      >
        Save Review
      </button>
    </div>
  );
}
