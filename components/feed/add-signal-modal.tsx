// components/feed/add-signal-modal.tsx
"use client";

import { useEffect, useState } from "react";
import { thesisTitle } from "@/lib/thesis-title";
import type { IntelligenceSignal } from "@/lib/types";

type ThesisOption = { id: string; title: string | null; ticker: string | null };

export function AddSignalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [priority, setPriority] = useState<IntelligenceSignal["priority"]>("blue");
  const [headline, setHeadline] = useState("");
  const [ticker, setTicker] = useState("");
  const [theme, setTheme] = useState("");
  const [thesisOptions, setThesisOptions] = useState<ThesisOption[]>([]);
  const [selectedThesisId, setSelectedThesisId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/theses")
      .then((res) => res.json())
      .then((body: { theses?: ThesisOption[] }) => setThesisOptions(body.theses ?? []))
      .catch(() => setThesisOptions([]));
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority,
          headline,
          ticker: ticker || undefined,
          theme: theme || undefined,
          thesis_id: selectedThesisId || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to add signal");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add signal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Add Signal</h2>
        <div className="mb-4 flex flex-col gap-3">
          <select value={priority} onChange={(e) => setPriority(e.target.value as IntelligenceSignal["priority"])} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
            <option value="red">Red — thesis-break</option>
            <option value="amber">Amber — thesis test</option>
            <option value="blue">Blue — general signal</option>
            <option value="grey">Grey — background</option>
          </select>
          <input placeholder="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input placeholder="Ticker (optional)" value={ticker} onChange={(e) => setTicker(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <input placeholder="Theme (optional)" value={theme} onChange={(e) => setTheme(e.target.value)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <label className="flex flex-col gap-1 text-xs text-on-surface/50">
            Link to Thesis (optional)
            <select
              value={selectedThesisId}
              onChange={(e) => setSelectedThesisId(e.target.value)}
              className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm text-on-surface"
            >
              <option value="">— None —</option>
              {thesisOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {thesisTitle(t)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="mb-4 text-xs text-status-red">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={submitting || !headline.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
