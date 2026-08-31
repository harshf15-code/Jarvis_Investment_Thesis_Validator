"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";

import { statedRationale } from "@/lib/holding-watch";

/**
 * "Why I own this" for an imported holding.
 *
 * A broker CSV carries ticker, quantity and cost — never the reason. Without
 * one, every read Jarvis writes can describe what changed but can never answer
 * whether it matters, and comes back `UNCLEAR` with `still_intact: null`. This
 * panel is the only place that gap can be closed after the import, so it says
 * so plainly rather than presenting itself as an optional note field.
 *
 * Rendered for imported holdings only. A Jarvis thesis already has a reason —
 * a long one — and its text is what the whole memorandum was generated from,
 * so the route refuses to rewrite it.
 */
export function HoldingRationalePanel({
  thesisId,
  ticker,
  inputText,
  onSaved,
}: {
  thesisId: string;
  ticker: string;
  inputText: string | null;
  onSaved: () => void;
}) {
  const stated = statedRationale(inputText, ticker);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stated ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = draft.trim();
    if (value === "") {
      setError("Write something, or cancel — an empty reason is what you have now.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_text: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't save that.");
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
            Why you own this
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Your own words. Every read Jarvis writes is checked against this — without
            it there is nothing to check, and the answer comes back &ldquo;unclear&rdquo;.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(stated ?? "");
              setError(null);
              setEditing(true);
            }}
            className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface"
          >
            <NotebookPen className="size-3.5" />
            {stated ? "Edit" : "Add your reason"}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
      )}

      {editing ? (
        <div className="flex flex-col gap-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={2000}
            autoFocus
            placeholder={`Why did you buy ${ticker}? What would have to change for you to sell?`}
            className="sunken w-full rounded-lg px-3.5 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
              className="rounded-full px-4 py-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              Cancel
            </button>
            <span className="ml-auto font-mono text-[10px] text-on-surface-variant/60">
              {draft.trim().length}/2000
            </span>
          </div>
          {stated && (
            <p className="text-xs text-on-surface-variant/70">
              Saving replaces what is there now. Past reads keep the wording they were
              written against — they are a record of what you thought then.
            </p>
          )}
        </div>
      ) : stated ? (
        <p className="text-sm whitespace-pre-wrap text-on-surface">{stated}</p>
      ) : (
        <p className="text-sm text-on-surface-variant">
          Nothing recorded. This holding came from a CSV, which carries the ticker, the
          quantity and the cost — never the reason. Add one and re-run the read below.
        </p>
      )}
    </div>
  );
}
