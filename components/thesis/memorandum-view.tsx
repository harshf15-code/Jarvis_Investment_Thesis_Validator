"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Users, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { CouncilReportSchema, type CouncilReport } from "@/lib/jarvis-council";
import { CouncilTab } from "@/components/council/council-tab";
import { ConsultDialog } from "@/components/council/consult-dialog";
import { MemorandumSchema, type Memorandum } from "@/lib/jarvis-memorandum";
import { MARKETS } from "@/lib/markets";
import type { MarketCode, ThesisCandidate, ThesisMemorandum } from "@/lib/types";
import { BackTradeDialog } from "./back-trade-dialog";
import { ComparativeGrid } from "./comparative-grid";
import { ExitTab, StressTab, ThesisTab, TradeTab } from "./memorandum-tabs";

const BASE_TABS = [
  { id: "thesis", label: "Thesis" },
  { id: "stress", label: "Stress Test" },
  { id: "trade", label: "Trade Plan" },
  { id: "exit", label: "Exit" },
] as const;

/**
 * Council is appended only once a report exists, so the tab strip never offers
 * a tab that opens on nothing. The consult button beside the title is the
 * discoverability route until then.
 */
type TabId = (typeof BASE_TABS)[number]["id"] | "council";

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
  /** Markets this thesis was created for; each has its own memorandum. */
  const [markets, setMarkets] = useState<MarketCode[]>([]);
  const [market, setMarket] = useState<MarketCode | null>(null);
  const [tab, setTab] = useState<TabId>("thesis");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backing, setBacking] = useState(false);
  /** The stored council report for the current market, and the memo it read. */
  const [council, setCouncil] = useState<CouncilReport | null>(null);
  const [councilMemoId, setCouncilMemoId] = useState<string | null>(null);
  const [consulting, setConsulting] = useState(false);
  const [picking, setPicking] = useState(false);

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

  const run = useCallback(
    async (target?: MarketCode) => {
      const m = target ?? market;
      if (!m) return;
      setRunning(true);
      setError(null);
      try {
        const res = await fetch(`/api/theses/${thesisId}/memorandum?market=${m}`, {
          method: "POST",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Jarvis couldn't produce the memorandum.");
        adopt(body.memorandum, body.candidates ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setRunning(false);
      }
    },
    [thesisId, market, adopt],
  );

  /** Same validate-on-the-way-out discipline as `adopt` above. */
  const adoptCouncil = useCallback((row: { document: unknown; memorandum_id: string | null } | null) => {
    if (!row) {
      setCouncil(null);
      setCouncilMemoId(null);
      return;
    }
    const parsed = CouncilReportSchema.safeParse(row.document);
    setCouncil(parsed.success ? parsed.data : null);
    setCouncilMemoId(row.memorandum_id);
  }, []);

  const consult = useCallback(
    async (memberIds: string[]) => {
      if (!market) return;
      setPicking(false);
      setConsulting(true);
      setError(null);
      try {
        const res = await fetch(`/api/theses/${thesisId}/council?market=${market}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member_ids: memberIds }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "The Council could not be convened.");
        adoptCouncil(body.report);
        setTab("council");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setConsulting(false);
      }
    },
    [thesisId, market, adoptCouncil],
  );

  /**
   * Loads the memo for one market, and only spends model calls when there is
   * none — a run is two LLM calls plus five live quotes.
   *
   * Auto-run is deliberately limited to a single-market thesis. With several
   * markets selected, firing every one on mount would spend N x 2 model calls
   * before the trader has looked at anything; each extra market waits for its
   * own click instead.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = market ? `?market=${market}` : "";
        const res = await fetch(`/api/theses/${thesisId}/memorandum${qs}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const list: MarketCode[] = body.markets ?? [];
        if (list.length) setMarkets(list);
        if (!market && body.market) {
          setMarket(body.market as MarketCode);
        }
        const had = adopt(body.memorandum ?? null, body.candidates ?? []);

        // The council is per-market too, so it is re-read on every switch
        // rather than carried over from the market the trader just left.
        const councilRes = await fetch(
          `/api/theses/${thesisId}/council?market=${body.market ?? market}`,
        );
        const councilBody = await councilRes.json().catch(() => ({}));
        if (cancelled) return;
        adoptCouncil(councilRes.ok ? councilBody.report ?? null : null);

        const single = list.length <= 1;
        if (!had && !body.memorandum && autoRun && single && body.market) {
          void run(body.market as MarketCode);
        }
      } catch {
        // Falls through to the empty state with a run button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thesisId, market, autoRun, run, adopt, adoptCouncil]);

  const tabs = useMemo(
    () => (council ? [...BASE_TABS, { id: "council" as const, label: "Council" }] : BASE_TABS),
    [council],
  );

  // A market switch can take the Council tab out from under the trader mid-read.
  // Derived rather than corrected in an effect: there is no state to repair,
  // only a tab that is momentarily naming something that no longer exists.
  const activeTab: TabId = tab === "council" && !council ? "thesis" : tab;

  /**
   * Market switcher. Rendered above every state — empty, running and complete —
   * because with two markets selected one may have a memo while the other has
   * not been run yet, and the trader needs to be able to reach either.
   */
  const marketStrip =
    markets.length > 1 ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-widest text-on-surface-variant/60 uppercase">
          Market
        </span>
        {markets.map((m) => (
          <button
            key={m}
            type="button"
            disabled={running || consulting}
            onClick={() => setMarket(m)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50",
              m === market
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-white/10 text-on-surface-variant hover:border-white/25 hover:text-on-surface",
            )}
          >
            {MARKETS[m].label}
          </button>
        ))}
      </div>
    ) : null;

  const primary =
    candidates.find((c) => c.id === row?.primary_candidate_id) ??
    (memo ? candidates.find((c) => c.ticker === memo.primary_ticker) : undefined);

  if (running && !memo) {
    return (
      <div className="flex flex-col gap-4">
        {marketStrip}
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
        {marketStrip}
        {markets.length > 1 && market && (
          <p className="text-xs text-on-surface-variant">
            No {MARKETS[market].label} analysis yet — each market is priced and argued
            separately.
          </p>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-container px-4 py-3 text-sm text-error">
            <XCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
            <span>{error}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => void run()}
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
      {marketStrip}
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
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={running || consulting}
            className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2.5 font-display text-[10px] font-black uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
          >
            <Users className="size-3.5" strokeWidth={2.5} />
            {consulting ? "Deliberating…" : council ? "Consult again" : "Consult Investment Council"}
          </button>
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
        </div>
      </header>

      {consulting && (
        <p className="flex items-center gap-2 text-sm text-primary">
          <RefreshCw className="size-4 animate-spin" strokeWidth={2.5} />
          The Council is deliberating — each member is reading the memorandum and the whole priced
          field.
        </p>
      )}

      <ComparativeGrid candidates={candidates} memoCandidates={memo.candidates} />

      {/* Tabs */}
      <div className="custom-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.06)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={activeTab === t.id ? "true" : undefined}
              className={cn(
                "border-b-2 px-5 py-3 font-display text-[11px] font-black uppercase tracking-widest transition-colors",
                activeTab === t.id
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
        {activeTab === "thesis" && <ThesisTab memo={memo} />}
        {activeTab === "stress" && <StressTab memo={memo} />}
        {activeTab === "trade" && <TradeTab memo={memo} />}
        {activeTab === "exit" && <ExitTab memo={memo} />}
        {activeTab === "council" && council && (
          <CouncilTab
            report={council}
            stale={councilMemoId !== null && row !== null && councilMemoId !== row.id}
            running={consulting}
            onRerun={() => setPicking(true)}
          />
        )}
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
          onClick={() => void run()}
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

      {picking && <ConsultDialog onClose={() => setPicking(false)} onConfirm={consult} />}

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
