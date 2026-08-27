"use client";

import type { JarvisAnalysis } from "@/lib/types";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Small dropdown listing every `jarvis_analyses` version for a stock,
 * newest first, the `is_latest` one labeled "Latest". Purely presentational
 * — `jarvis-tabs.tsx` owns the "which version is currently selected" state
 * and the already-fetched list of versions; this component only renders the
 * control and reports a selection back via `onChange`, so switching never
 * requires a refetch.
 */
export function AnalysisVersionPicker({
  analyses,
  selectedId,
  onChange,
}: {
  /** Newest first. */
  analyses: JarvisAnalysis[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      aria-label="Analysis version"
      value={selectedId}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-lg border-0 border-b-2 border-b-transparent bg-surface-container-highest px-2.5 text-xs font-medium text-on-surface outline-none transition-colors focus:border-b-primary"
    >
      {analyses.map((analysis) => (
        <option key={analysis.id} value={analysis.id}>
          {analysis.is_latest ? "Latest" : `v${analysis.version}`} —{" "}
          {formatDate(analysis.created_at)}
        </option>
      ))}
    </select>
  );
}
