"use client";

import { use, useEffect, useState } from "react";

import { CandidateBakeoff } from "@/components/thesis/candidate-bakeoff";
import { ConvictionBadge } from "@/components/thesis/conviction-badge";
import { StressTestPanel } from "@/components/thesis/stress-test-panel";
import { TradePlanGrid } from "@/components/thesis/trade-plan-grid";
import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { LastUpdated } from "@/components/shared/last-updated";
import type { BearCase, ConvictionTier, ExchangeCode, ThesisMode } from "@/lib/types";

type ThesisDetail = {
  id: string;
  stock_id: string | null;
  ticker: string | null;
  mode: ThesisMode;
  selected_candidate_id: string | null;
  conviction_tier: ConvictionTier | null;
  conviction_score: number | null;
  bear_cases: BearCase[];
};

type ThesisDetailResponse = {
  thesis: ThesisDetail;
  stock: { exchange: ExchangeCode; last_price: number | null; last_price_at: string | null } | null;
};

async function fetchThesis(id: string): Promise<ThesisDetailResponse> {
  const res = await fetch(`/api/theses/${id}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Thesis not found.");
  return body as ThesisDetailResponse;
}

/** A failed refresh is not fatal — the caller falls back to the stock's stored `last_price`. */
async function fetchQuote(stockId: string): Promise<{ price: number; asOf: string } | null> {
  try {
    const res = await fetch("/api/prices/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stockIds: [stockId] }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.prices?.[stockId] ?? null;
  } catch {
    return null;
  }
}

/**
 * Screen 2-3 (US-11, US-12): the two-step wizard a thesis flows into after
 * being approved on Screen 1 — stress-test review, then the 9-cell trade plan.
 *
 * CMP is fetched once, directly, via `POST /api/prices/refresh` (Task 4) —
 * the app's on-demand refresh mechanism (Global Constraint: no client-side
 * polling). There's no "Refresh Prices" button on this single-pass wizard,
 * so `usePriceRefresh` (Task 4's wrapper hook, meant for a page the user
 * stays on and can manually re-trigger) isn't needed here.
 *
 * This is a client component rather than the repo's usual server-component +
 * `fetchInternalApi` page because the first load fires the stress-test LLM
 * call (up to 60s), which needs the spec's amber skeleton on screen while it
 * runs rather than a blocked server render.
 */
export default function ThesisPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [thesis, setThesis] = useState<ThesisDetail | null>(null);
  const [step, setStep] = useState<2 | 3>(2);
  const [cmp, setCmp] = useState<number | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [exchange, setExchange] = useState<ExchangeCode>("US");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let body = await fetchThesis(id);

        // Screen 2's bear cases are generated on first arrival and persisted,
        // so returning to the wizard reuses them instead of re-running Jarvis.
        if (body.thesis.bear_cases.length === 0) {
          const stressRes = await fetch(`/api/theses/${id}/stress-test`, { method: "POST" });
          if (!stressRes.ok) {
            const payload = await stressRes.json().catch(() => ({}));
            throw new Error(payload.error ?? "Jarvis couldn't stress-test this thesis.");
          }
          body = await fetchThesis(id);
        }

        const quote = body.thesis.stock_id ? await fetchQuote(body.thesis.stock_id) : null;
        if (cancelled) return;

        setThesis(body.thesis);
        if (body.stock?.exchange) setExchange(body.stock.exchange);
        setCmp(quote?.price ?? body.stock?.last_price ?? null);
        setPriceAsOf(quote?.asOf ?? body.stock?.last_price_at ?? null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  function retry() {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }

  if (loading) {
    return <SkeletonLoader lines={6} />;
  }

  if (error || !thesis) {
    return (
      <div className="rounded-xl bg-status-red-container px-4 py-3 text-sm text-status-red">
        {error ?? "Thesis not found."}{" "}
        <button type="button" onClick={retry} className="underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl text-on-surface">
          {thesis.ticker ?? "Macro Thesis"} — Validation &amp; Plan
        </h1>
        {thesis.conviction_tier && <ConvictionBadge tier={thesis.conviction_tier} />}
        <LastUpdated at={priceAsOf} exchange={exchange} />
      </div>
      {step === 2 ? (
        <StressTestPanel
          thesisId={id}
          bearCases={thesis.bear_cases}
          convictionScore={thesis.conviction_score}
          onApproved={() => setStep(3)}
        />
      ) : thesis.stock_id === null ? (
        /*
         * A macro thesis reaches Step 3 with no instrument, and every part of
         * Step 3 needs one: the draft anchors its levels to CMP, and
         * `POST /api/trade-plans` rejects a thesis with no `stock_id`. The
         * guard lives here rather than only on the buttons that route here,
         * because this page is also reachable by link, bookmark and reload.
         *
         * Showing the bake-off is the point — the missing instrument is a step
         * the user hasn't taken yet, not an error, so this is the step itself
         * rather than a dead end telling them to go back.
         */
        <div className="flex flex-col gap-4">
          {thesis.mode === "thesis_only" ? (
            <>
              <p className="text-sm text-on-surface-variant">
                This thesis doesn&apos;t name a stock yet. Back one of the candidates below and the
                trade plan will build against it.
              </p>
              <CandidateBakeoff
                thesisId={id}
                selectedCandidateId={thesis.selected_candidate_id}
                onPicked={retry}
              />
            </>
          ) : (
            /*
             * The thesis names a stock but it never resolved to live market
             * data — `POST /api/theses` keeps the ticker it extracted even when
             * the Yahoo lookup misses on every exchange. Running a candidate
             * shortlist here would be wrong: the instrument isn't undecided,
             * it's unpriceable, usually because the ticker is misspelled or
             * isn't listed on NSE or US.
             */
            <div className="rounded-lg bg-status-blue-container px-4 py-3 text-sm text-status-blue">
              Couldn&apos;t price{" "}
              <span className="font-mono font-medium">{thesis.ticker ?? "this thesis"}</span> — the
              ticker didn&apos;t resolve on NSE or US, so there&apos;s no CMP to build a plan
              against. Check the symbol and start a new thesis with the exact exchange ticker.{" "}
              <button type="button" onClick={retry} className="underline">
                Retry
              </button>
            </div>
          )}
        </div>
      ) : (
        <TradePlanGrid thesisId={id} cmp={cmp} exchange={exchange} />
      )}
    </div>
  );
}
