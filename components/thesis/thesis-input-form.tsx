"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SendHorizontal } from "lucide-react";

import { SkeletonLoader } from "@/components/shared/skeleton-loader";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import { cn } from "@/lib/utils";
import type { MarketCode } from "@/lib/types";

/**
 * Screen 1 (spec US-09/US-10). Single free-text input, no dropdowns, no
 * mandatory fields — mode is entirely inferred server-side by Task 9's route.
 * Used both as the always-available drawer content (Task 6) and as its own page
 * (`app/(app)/thesis/new/page.tsx`).
 *
 * Structuring the thesis is now only the first half of one request: the form
 * hands straight off to the memorandum, which runs the comparison and produces
 * the full document. It no longer renders the six fields itself — showing a
 * summary here and the same fields again on the memo made the user read the
 * thesis twice before seeing any analysis.
 */
export function ThesisInputForm({
  prefillTicker,
  onSaved,
}: {
  prefillTicker?: string;
  onSaved?: (thesisId: string) => void;
}) {
  const router = useRouter();
  const [inputText, setInputText] = useState(prefillTicker ?? "");
  // Defaults to India alone rather than every live market: each extra market is
  // a separate two-call analysis, so opting in should be deliberate.
  const [markets, setMarkets] = useState<MarketCode[]>(["IN"]);
  // Unticked by default. Ticking it is the ONLY way a ticker reaches
  // `theses.ticker`, which is what anchors the whole comparison to one name.
  const [namesStocks, setNamesStocks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMarket(m: MarketCode) {
    setMarkets((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function handleSubmit() {
    if (!inputText.trim() || markets.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/theses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_text: inputText,
          markets,
          names_stocks: namesStocks,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Jarvis is thinking... Taking longer than usual.");
      }
      onSaved?.(body.thesis.id);
      router.push(`/thesis/${body.thesis.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
          Thesis Engine
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          Name a stock, describe a market view, or both. Jarvis will pick the field, price every
          candidate, and come back with the whole call.
        </p>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-widest text-on-surface-variant uppercase">
          Markets
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {MARKET_ORDER.map((code) => {
            const meta = MARKETS[code];
            const selected = markets.includes(code);
            return (
              <button
                key={code}
                type="button"
                disabled={!meta.live || loading}
                aria-pressed={selected}
                onClick={() => toggleMarket(code)}
                title={meta.live ? undefined : "Coming soon"}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  !meta.live
                    ? "cursor-not-allowed border-white/5 text-on-surface-variant/40"
                    : selected
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-white/10 text-on-surface-variant hover:border-white/25 hover:text-on-surface",
                )}
              >
                {meta.label}
                {!meta.live && <span className="ml-1.5 text-[9px] opacity-70">soon</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-on-surface-variant/70">
          {markets.length > 1
            ? `One separate memorandum per market — ${markets.length} analyses.`
            : "Jarvis will only shortlist names listed in the market you pick."}
        </p>
      </div>

      <div className="relative">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter keeps a newline, since a thesis is
            // often a couple of sentences.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="e.g. Indian banks and NBFCs have NPAs at all-time lows — good time to be long the sector."
          rows={5}
          disabled={loading}
          className="sunken w-full resize-none rounded-lg p-4 pr-16 text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !inputText.trim() || markets.length === 0}
          aria-label="Send to Jarvis"
          className="absolute right-3 bottom-3 flex size-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-95 disabled:opacity-40 disabled:shadow-none"
        >
          <SendHorizontal className="size-4" strokeWidth={2.5} />
        </button>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-xs text-on-surface-variant">
        <input
          type="checkbox"
          checked={namesStocks}
          onChange={(e) => setNamesStocks(e.target.checked)}
          disabled={loading}
          className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-primary)]"
        />
        <span>
          I&apos;m naming specific stock(s) above.
          <span className="block text-on-surface-variant/60">
            Leave this off for a sector or macro view — Jarvis will build the field itself
            instead of anchoring to one name.
          </span>
        </span>
      </label>

      {loading && (
        <>
          <p className="text-xs text-primary">Structuring the thesis…</p>
          <SkeletonLoader lines={4} />
        </>
      )}

      {error && (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
          {error}{" "}
          <button type="button" onClick={handleSubmit} className="underline">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
