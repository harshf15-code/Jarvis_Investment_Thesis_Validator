"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { MemorandumSchema, type Memorandum } from "@/lib/jarvis-memorandum";
import type { ThesisCandidate, ThesisMemorandum } from "@/lib/types";
import { BackTradeDialog } from "./back-trade-dialog";
import { ComparativeGrid } from "./comparative-grid";
import { ExitTab, StressTab, ThesisTab, TradeTab } from "./memorandum-tabs";

const TABS = [
  { id: "thesis", label: "Thesis" },
  { id: "stress", label: "Stress Test" },
  { id: "trade", label: "Trade Plan" },
  { id: "exit", label: "Exit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * The Jarvis memorandum — the whole decision in one screen.
 *
 * Replaces the old click-through (structure a thesis, pick a candidate, run a
 * stress test, then fill a plan). Jarvis compares every candidate and hands
 * back a finished document; the trader's only input is whether to back it.
 */
export function MemorandumView({
  thesisId,
  autoRun = true,
}: {
  thesisId: string;
  /** When false, waits for an explicit "Run analysis" click. */
  autoRun?: boolean;
}) {
  const [memo, setMemo] = useState<Memorandum | null>(null);
  const [row, setRow] = useState<ThesisMemorandum | null>(null);
  const [candidates, setCandidates] = useState<ThesisCandidate[]>([]);
  const [tab, setTab] = useState<TabId>("thesis");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backing, setBacking] = useState(false);

  /**
   * Documents are validated on the way OUT of the database as well as in.
   * `document` is jsonb the schema has already changed under once; a row
   * written by an older shape must degrade to "re-run this" rather than crash
   * the render on a missing field.
   */
  const adopt = useCallback((memorandum: ThesisMemorandum | null, cands: ThesisCandidate[]) => {
    setCandidates(cands);
    setRow(memorandum);
    if (!memorandum) {
      setMemo(null);
      return false;
    }
    const parsed = MemorandumSchema.safeParse(memorandum.document);
    if (!parsed.success) {
      setMemo(null);
      setError("This memorandum was written in an older format. Re-run it to refresh.");
      return false;
    }
    setMemo(parsed.data);
    return true;
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}/memorandum`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Jarvis couldn't produce the memorandum.");
      adopt(body.memorandum, body.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }, [thesisId, adopt]);

  // Show a previous memo if one exists, and only spend model calls when none
  // does — the run is two LLM calls plus five live quotes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/theses/${thesisId}/memorandum`);
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const had = adopt(body.memorandum ?? null, body.candidates ?? []);
        if (!had && !body.memorandum && autoRun) void run();
      } catch {
        // Falls through to the empty state with a run button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thesisId, autoRun, run, adopt]);

  const primary =
    candidates.find((c) => c.id === row?.primary_candidate_id) ??
    (memo ? candidates.find((c) => c.ticker === memo.primary_ticker) : undefined);

  if (running && !memo) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-primary">
          <RefreshCw className="size-4 animate-spin" strokeWidth={2.5} />
          Jarvis is comparing the field — pricing every candidate, stress-testing the winner, and
          costing the trade. This takes a minute.
        </p>
        <div className="h-32 animate-pulse rounded-lg bg-white/5" />
        <div className="h-64 animate-pulse rounded-lg bg-white/5" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex flex-col items-start gap-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-container px-4 py-3 text-sm text-error">
            <XCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
            <span>{error}</span>
          </div>
        )}
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-full bg-primary px-6 py-3 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40"
        >
          {running ? "Analysing…" : "Run Jarvis analysis"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[10px] font-black uppercase tracking-[0.28em] text-primary">
            {memo.header.system_id ?? "Jarvis Trading System"}
            {memo.header.sector_theme ? ` · ${memo.header.sector_theme}` : ""}
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-extrabold leading-tight tracking-tighter text-on-surface">
            {memo.header.title ?? "Pick A Winner"}
          </h1>
        </div>
        <div className="text-right font-mono text-[10px] leading-relaxed text-on-surface-variant/50">
          {row?.created_at && (
            <div>
              {new Date(row.created_at)
                .toLocaleDateString(undefined, { month: "short", year: "numeric" })
                .toUpperCase()}
            </div>
          )}
          {memo.header.data_source && <div>{memo.header.data_source}</div>}
        </div>
      </header>

      <ComparativeGrid candidates={candidates} memoCandidates={memo.candidates} />

      {/* Tabs */}
      <div className="custom-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.06)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "true" : undefined}
              className={cn(
                "border-b-2 px-5 py-3 font-display text-[11px] font-black uppercase tracking-widest transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant/50 hover:text-on-surface",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {tab === "thesis" && <ThesisTab memo={memo} />}
        {tab === "stress" && <StressTab memo={memo} />}
        {tab === "trade" && <TradeTab memo={memo} />}
        {tab === "exit" && <ExitTab memo={memo} />}
      </div>

      {/* The decision */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => setBacking(true)}
          disabled={!primary}
          className="rounded-full bg-primary px-6 py-3 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
        >
          {primary ? `Back ${primary.company_name ?? primary.ticker}` : "No pick available"}
        </button>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3", running && "animate-spin")} strokeWidth={2.5} />
          {running ? "Re-running" : "Re-run analysis"}
        </button>
        <span className="text-xs text-on-surface-variant">
          Backing logs a position against this plan. Passing costs nothing.
        </span>
      </div>

      {error && memo && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
      )}

      {backing && primary && (
        <BackTradeDialog
          thesisId={thesisId}
          memo={memo}
          candidate={primary}
          onClose={() => setBacking(false)}
        />
      )}
    </div>
  );
}
