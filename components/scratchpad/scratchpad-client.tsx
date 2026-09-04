"use client";

import { useCallback, useEffect, useState } from "react";

import { NotesPanel } from "@/components/scratchpad/notes-panel";
import { PatternReadPanel } from "@/components/scratchpad/pattern-read-panel";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import type { Portfolio, PortfolioPatternReadRow, ScratchpadNote } from "@/lib/types";

/**
 * The Scratchpad's two halves, and the one piece of state they share.
 *
 * Notes live here rather than inside `NotesPanel` because a suggestion in the
 * pattern read on the left has to be able to become a note on the right without
 * a refetch or a reload. That is the whole reason the PRD puts them on one
 * screen: a note can react to the pattern, and the pattern is written knowing
 * what the notes say.
 */
export function ScratchpadClient({
  heldTickers,
  portfolio,
}: {
  heldTickers: string[];
  /** The book on screen. Null in the roll-up, where notes are readable across
   *  every book but a new one has no single book to belong to. */
  portfolio: Portfolio | null;
}) {
  const portfolioId = portfolio?.id ?? null;
  const scopeParam = portfolioId ?? "all";
  const [notes, setNotes] = useState<ScratchpadNote[]>([]);
  const [notesTruncated, setNotesTruncated] = useState(false);
  const [reads, setReads] = useState<PortfolioPatternReadRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [notesRes, readsRes] = await Promise.all([
          fetch(`/api/scratchpad/notes?portfolio=${scopeParam}`),
          fetch(`/api/scratchpad/pattern?portfolio=${scopeParam}`),
        ]);
        const notesBody = await notesRes.json().catch(() => ({}));
        const readsBody = await readsRes.json().catch(() => ({}));
        if (!notesRes.ok) throw new Error(notesBody.error ?? "Couldn't load your notes.");
        if (!readsRes.ok) throw new Error(readsBody.error ?? "Couldn't load your pattern reads.");
        if (cancelled) return;
        setNotes(notesBody.notes ?? []);
        setNotesTruncated(notesBody.truncated === true);
        setReads(readsBody.reads ?? []);
        setNextBefore(readsBody.nextBefore ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [scopeParam]);

  /** Shared by the composer and by accepting a suggestion from the read. */
  const addNote = useCallback(
    async (body: string, ticker: string | null) => {
      // A note is written about a book. In the roll-up there is no single book
      // it could belong to, so the composer is not offered — this refusal is
      // the backstop, not the message the trader reads.
      if (!portfolioId) throw new Error("Choose a portfolio before writing a note.");
      const res = await fetch("/api/scratchpad/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId, body, ticker }),
      });
      const parsed = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parsed.error ?? "Couldn't save that note.");
      setNotes((prev) => [parsed.note, ...prev]);
    },
    [portfolioId],
  );

  const patchNote = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/scratchpad/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parsed.error ?? "Couldn't save that change.");
    setNotes((prev) => prev.map((n) => (n.id === id ? parsed.note : n)));
  }, []);

  if (loading) return <SkeletonLoader lines={8} />;

  if (error) {
    return (
      <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
        {error}{" "}
        <button type="button" onClick={() => location.reload()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <PatternReadPanel
        reads={reads}
        nextBefore={nextBefore}
        heldTickers={heldTickers}
        portfolio={portfolio}
        onRead={(read) => setReads((prev) => [read, ...prev])}
        onLoadedOlder={(older, before) => {
          setReads((prev) => [...prev, ...older]);
          setNextBefore(before);
        }}
        onAcceptSuggestion={addNote}
      />
      <NotesPanel
        notes={notes}
        truncated={notesTruncated}
        canCreate={portfolioId !== null}
        onCreate={addNote}
        onPatch={patchNote}
      />
    </div>
  );
}
