"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import { THESIS_TITLE_MAX, thesisTitle } from "@/lib/thesis-title";

/**
 * The thesis's name, renameable in place.
 *
 * Deliberately separate from the memorandum's own `<h1>`, which is the
 * memorandum's headline ("Pick A Winner") and belongs to the analysis. This is
 * the name of the IDEA — the string the thesis list shows, the one that has to
 * still mean something in six months.
 *
 * Renaming is allowed on every thesis, including ones Jarvis wrote. The title
 * is a label and nothing is derived from it, unlike `input_text`, which the
 * whole analysis was generated from and which the route therefore refuses to
 * change on anything but an imported holding.
 */
export function ThesisTitleBar({ thesisId }: { thesisId: string }) {
  const [thesis, setThesis] = useState<{ title: string | null; ticker: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/theses/${thesisId}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !body.thesis) return;
        setThesis({ title: body.thesis.title ?? null, ticker: body.thesis.ticker ?? null });
      } catch {
        // A missing title bar is a far smaller loss than a blocked memorandum,
        // so this stays silent and simply renders nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thesisId]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!thesis) return null;

  const current = thesisTitle(thesis);

  async function save() {
    // The tick button is disabled while a save is in flight; the Enter key is
    // not, and holding it sends a PATCH per repeat. They all succeed, but a
    // slow one landing after a fast one can paint an error over a title that
    // saved — so the guard is here rather than on the one control that had it.
    if (busy) return;
    const next = draft.trim();
    if (next === "" || next === current) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't rename this thesis.");
      setThesis((prev) => (prev ? { ...prev, title: body.thesis.title } : prev));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            maxLength={THESIS_TITLE_MAX}
            aria-label="Thesis name"
            className="min-w-0 flex-1 rounded-lg bg-surface-container-highest px-3 py-1.5 font-display text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            aria-label="Save name"
            className="rounded-full bg-white/5 p-1.5 text-on-surface-variant hover:text-primary disabled:opacity-50"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Cancel rename"
            className="rounded-full bg-white/5 p-1.5 text-on-surface-variant hover:text-on-surface"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
          className="group flex items-center gap-2 self-start text-left"
        >
          <span className="font-display text-sm text-on-surface-variant">{current}</span>
          <Pencil className="size-3 text-on-surface-variant/40 transition-colors group-hover:text-on-surface-variant" />
        </button>
      )}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}
