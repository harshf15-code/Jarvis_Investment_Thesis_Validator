"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, NotebookPen, Undo2 } from "lucide-react";

import type { ScratchpadNote } from "@/lib/types";

/**
 * "Your notes" — the trader's own half of the Scratchpad.
 *
 * No model call anywhere in here. The whole point is a place to put a
 * half-formed idea without it having to become a thesis first, so the only
 * required field is the text.
 */
export function NotesPanel({
  notes,
  onCreate,
  onPatch,
}: {
  notes: ScratchpadNote[];
  onCreate: (body: string, ticker: string | null) => Promise<void>;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTicker, setDraftTicker] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = notes.filter((n) => n.archived_at === null);
  const archived = notes.filter((n) => n.archived_at !== null);

  // Built from the notes already loaded and applied client-side: this list is
  // small and entirely in memory, so making a filter cost a round trip would be
  // paying for nothing.
  const tickers = useMemo(
    () => [...new Set(live.map((n) => n.ticker).filter((t): t is string => !!t))].sort(),
    [live],
  );
  const shown = filter ? live.filter((n) => n.ticker === filter) : live;

  async function save() {
    const body = draft.trim();
    if (body === "") {
      setError("Write something, or cancel.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(body, draftTicker.trim() || null);
      setDraft("");
      setDraftTicker("");
      setComposing(false);
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
            Your notes
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            An idea, before it is a thesis. A ticker is optional — plenty of ideas do not have
            one yet.
          </p>
        </div>
        {!composing && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setComposing(true);
            }}
            className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface"
          >
            <NotebookPen className="size-3.5" />
            New note
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>}

      {composing && (
        <div className="flex flex-col gap-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={4000}
            autoFocus
            placeholder="What did you notice?"
            className="sunken w-full rounded-lg px-3.5 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
          />
          <input
            value={draftTicker}
            onChange={(e) => setDraftTicker(e.target.value)}
            maxLength={24}
            placeholder="Ticker (optional)"
            className="sunken rounded-lg px-3.5 py-2.5 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
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
                setComposing(false);
                setError(null);
              }}
              disabled={busy}
              className="rounded-full px-4 py-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              Cancel
            </button>
            <span className="ml-auto font-mono text-[10px] text-on-surface-variant/60">
              {draft.trim().length}/4000
            </span>
          </div>
        </div>
      )}

      {tickers.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="All" active={filter === null} onClick={() => setFilter(null)} />
          {tickers.map((t) => (
            <FilterChip
              key={t}
              label={t}
              active={filter === t}
              onClick={() => setFilter(filter === t ? null : t)}
            />
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          {live.length === 0
            ? "Nothing here yet. A half-formed thought is worth writing down — it is the thing you will not remember later."
            : `No notes tagged ${filter}.`}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {shown.map((note) => (
            <NoteCard key={note.id} note={note} onPatch={onPatch} />
          ))}
        </ol>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="text-xs text-on-surface-variant underline transition-colors hover:text-on-surface"
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <ol className="mt-3 flex flex-col gap-3">
              {archived.map((note) => (
                <NoteCard key={note.id} note={note} onPatch={onPatch} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 font-mono text-[10px] tracking-wider uppercase transition-colors ${
        active
          ? "bg-primary text-on-primary"
          : "bg-white/5 text-on-surface-variant hover:bg-white/10 hover:text-on-surface"
      }`}
    >
      {label}
    </button>
  );
}

function NoteCard({
  note,
  onPatch,
}: {
  note: ScratchpadNote;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isArchived = note.archived_at !== null;

  async function run(patch: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await onPatch(note.id, patch);
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-lg bg-white/5 p-3 ${isArchived ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
          {note.created_at.slice(0, 10)}
          {note.ticker ? ` · ${note.ticker}` : ""}
        </span>
        <div className="flex items-center gap-1">
          {!isArchived && !editing && (
            <button
              type="button"
              onClick={() => {
                setDraft(note.body);
                setEditing(true);
              }}
              className="rounded-full px-2 py-1 text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ archived: !isArchived })}
            title={isArchived ? "Put this back on the list" : "Archive — never deleted"}
            className="rounded-full p-1.5 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
          >
            {isArchived ? <Undo2 className="size-3.5" /> : <Archive className="size-3.5" />}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={4000}
            autoFocus
            className="sunken w-full rounded-lg px-3.5 py-3 text-sm text-on-surface focus:ring-1 focus:ring-primary/40 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ body: draft.trim() }, () => setEditing(false))}
              className="rounded-full bg-primary px-3 py-1.5 text-[10px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-full px-3 py-1.5 text-[10px] text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-sm whitespace-pre-wrap text-on-surface">{note.body}</p>
      )}

      {/* Only with a ticker: `/thesis/new?ticker=` is the exact param
          `OpportunityCard` already uses, and it needs a symbol to prefill. */}
      {note.ticker && !isArchived && !editing && (
        <Link
          href={`/thesis/new?ticker=${encodeURIComponent(note.ticker)}`}
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary transition-opacity hover:opacity-80"
        >
          Start a thesis from this
          <ArrowUpRight className="size-3" />
        </Link>
      )}
    </li>
  );
}
