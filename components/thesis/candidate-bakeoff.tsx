"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CandidateVerdict, ThesisCandidate } from "@/lib/types";

const VERDICT_STYLE: Record<CandidateVerdict, { label: string; className: string }> = {
  bet: { label: "BET", className: "bg-primary/10 text-primary" },
  watch: { label: "WATCH", className: "bg-status-blue-container text-status-blue" },
  avoid: { label: "AVOID", className: "bg-error-container text-error" },
};

function formatPrice(cmp: number | null, exchange: string | null): string {
  if (cmp == null) return "unpriced";
  const symbol = exchange === "NSE" || exchange === "BSE" ? "₹" : "$";
  return `${symbol}${cmp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The head-to-head for a thesis that named no stock (spec Mode "thesis_only").
 *
 * Running Jarvis on a macro idea used to end at a list of ticker strings the app
 * had never analysed, which meant the trade plan downstream had no instrument
 * and no CMP. This runs the real comparison — live price and fundamentals for
 * every name, one ranked verdict — and ends on a choice that writes the winner
 * back onto the thesis.
 */
export function CandidateBakeoff({
  thesisId,
  selectedCandidateId,
  onPicked,
  autoRun = true,
}: {
  thesisId: string;
  selectedCandidateId?: string | null;
  /** Fires after the winner is written back to the thesis. */
  onPicked?: (candidate: ThesisCandidate) => void;
  /** When false, waits for an explicit "Run comparison" click. */
  autoRun?: boolean;
}) {
  const [candidates, setCandidates] = useState<ThesisCandidate[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(selectedCandidateId ?? null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}/candidates`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Comparison failed.");
      setCandidates(body.candidates ?? []);
      setVerdict(body.comparativeVerdict ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }, [thesisId]);

  // On mount, show a previous run if there is one and only spend model calls
  // when there isn't. Without this, reopening a thesis would re-bill the
  // comparison every time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/theses/${thesisId}/candidates`);
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const existing: ThesisCandidate[] = body.candidates ?? [];
        if (existing.length > 0) {
          setCandidates(existing);
          return;
        }
        if (autoRun) void run();
      } catch {
        // A failed read just means we show the empty state with a run button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thesisId, autoRun, run]);

  async function pick(candidate: ThesisCandidate) {
    setPicking(candidate.id);
    setError(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_candidate_id: candidate.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not select that candidate.");
      setPicked(candidate.id);
      onPicked?.(candidate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPicking(null);
    }
  }

  return (
    <section className="glass-panel overflow-hidden rounded-lg">
      <div className="flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
            Candidate Bake-Off
          </h2>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Same analysis run on every name, then ranked head-to-head.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="flex shrink-0 items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3", running && "animate-spin")} strokeWidth={2.5} />
          {running ? "Analysing" : candidates.length > 0 ? "Re-run" : "Run comparison"}
        </button>
      </div>

      {error && (
        <div className="mx-5 mb-5 rounded-lg bg-error-container px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {running && candidates.length === 0 && (
        <div className="space-y-3 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-px bg-white/5">
          {candidates.map((c) => {
            const style = VERDICT_STYLE[c.verdict];
            const isPicked = picked === c.id;
            return (
              <article key={c.id} className="bg-surface-container/40 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[10px] font-medium text-on-surface-variant/60">
                    #{c.rank}
                  </span>
                  <h3 className="font-display text-lg font-extrabold tracking-tight text-on-surface">
                    {c.ticker}
                  </h3>
                  {c.company_name && (
                    <span className="text-xs text-on-surface-variant">{c.company_name}</span>
                  )}
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                      style.className,
                    )}
                  >
                    {style.label}
                  </span>
                  <span
                    className={cn(
                      "ml-auto font-mono text-sm",
                      c.cmp == null ? "text-on-surface-variant/50 italic" : "text-on-surface",
                    )}
                  >
                    {formatPrice(c.cmp, c.exchange)}
                  </span>
                </div>

                {c.score != null && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          c.verdict === "avoid" ? "bg-error" : "bg-primary",
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, c.score))}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-on-surface-variant">
                      {Math.round(c.score)}
                    </span>
                  </div>
                )}

                {c.fit_rationale && (
                  <p className="mt-3 text-sm leading-relaxed text-on-surface/90">
                    {c.fit_rationale}
                  </p>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {c.bull_case && (
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-primary">
                        <TrendingUp className="size-3" strokeWidth={2.5} /> Bull
                      </p>
                      <p className="text-xs leading-relaxed text-on-surface/80">{c.bull_case}</p>
                    </div>
                  )}
                  {c.bear_case && (
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-error">
                        <TrendingDown className="size-3" strokeWidth={2.5} /> Bear
                      </p>
                      <p className="text-xs leading-relaxed text-on-surface/80">{c.bear_case}</p>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => pick(c)}
                  disabled={picking !== null || isPicked}
                  className={cn(
                    "mt-4 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold tracking-tight transition-all disabled:opacity-60",
                    isPicked
                      ? "bg-primary/10 text-primary"
                      : "bg-white/5 text-on-surface hover:bg-white/10 active:scale-[0.97]",
                  )}
                >
                  {isPicked ? (
                    <>
                      <Check className="size-3.5" strokeWidth={3} /> Backing {c.ticker}
                    </>
                  ) : picking === c.id ? (
                    "Selecting…"
                  ) : (
                    `Back ${c.ticker}`
                  )}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {verdict && (
        <div className="bg-secondary-container/30 p-5">
          <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-secondary">
            Comparative verdict
          </p>
          <p className="text-sm leading-relaxed text-on-surface/90">{verdict}</p>
        </div>
      )}
    </section>
  );
}
