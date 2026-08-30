"use client";

import { cn } from "@/lib/utils";
import { formatMarketPrice } from "@/lib/markets";
import type { MarketCode, ThesisCandidate } from "@/lib/types";
import type { MemoCandidate } from "@/lib/jarvis-memorandum";

/** Shared with the Council tab so a verdict reads identically wherever it appears. */
export const VERDICT_STYLE = {
  BUY: "bg-primary/10 text-primary",
  WATCH: "bg-status-blue-container text-status-blue",
  AVOID: "bg-error-container text-error",
} as const;

export const DOT_COLOR = {
  BUY: "bg-primary",
  WATCH: "bg-status-blue",
  AVOID: "bg-error",
} as const;

/**
 * Formatting comes from the candidate's own market (0016) rather than the old
 * `exchange === "US" ? "$" : "₹"` ternary, which labelled every non-US price as
 * rupees. That was harmless while the universe was NSE/BSE/US and actively
 * misleading the moment it is not — a ¥6,052 quote rendered as ₹6,052 sits in
 * the same column as a $356 one with nothing to say they are different money.
 */
function formatPrice(cmp: number | null, market: MarketCode): string {
  if (cmp == null) return "—";
  return formatMarketPrice(cmp, market);
}

/**
 * Where the current price sits in the 52-week range, 0-100. Returns null when
 * the range is missing or degenerate (low === high), so the bar renders empty
 * rather than dividing by zero or pinning the dot at an arbitrary end.
 */
function rangePercentile(c: ThesisCandidate): number | null {
  const { cmp, range_low: low, range_high: high } = c;
  if (cmp == null || low == null || high == null || high <= low) return null;
  return Math.min(100, Math.max(0, ((cmp - low) / (high - low)) * 100));
}

/**
 * The comparative entity grid — up to five names side by side, the pick called
 * out. This is the memo's opening argument: the trade is a choice among these,
 * so they are shown together on the same measures before any prose.
 */
export function ComparativeGrid({
  candidates,
  memoCandidates,
}: {
  candidates: ThesisCandidate[];
  /** Model-written grid copy, keyed by ticker; the DB row carries the market data. */
  memoCandidates: MemoCandidate[];
}) {
  const memoByTicker = new Map(memoCandidates.map((c) => [c.ticker.toUpperCase(), c]));

  return (
    <div className="custom-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="grid min-w-[52rem] grid-cols-5 gap-px overflow-hidden rounded-lg bg-white/5">
        {candidates.map((c) => {
          const memo = memoByTicker.get(c.ticker.toUpperCase());
          const verdict = memo?.verdict ?? (c.verdict === "bet" ? "BUY" : c.verdict === "avoid" ? "AVOID" : "WATCH");
          const isPick = memo?.is_primary_pick ?? c.rank === 1;
          const pct = rangePercentile(c);

          return (
            <div
              key={c.id}
              className={cn(
                "relative p-4",
                isPick ? "bg-primary/[0.06]" : "bg-surface-container/40",
              )}
            >
              {isPick && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}

              <p className="font-mono text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                {c.ticker}
              </p>
              <p
                className={cn(
                  "mt-0.5 font-display text-sm font-extrabold tracking-tight",
                  isPick ? "text-primary" : "text-on-surface",
                )}
              >
                {c.company_name ?? c.ticker}
              </p>

              <p className="mt-2 font-mono text-lg text-on-surface">
                {formatPrice(c.cmp, c.market)}
              </p>
              <p
                className={cn(
                  "font-mono text-[10px]",
                  // Cheap/expensive is relative to this list, but an absolute
                  // read still helps: a loss-maker has no multiple at all.
                  memo?.valuation_metric?.toLowerCase().includes("loss")
                    ? "text-error"
                    : "text-on-surface-variant/70",
                )}
              >
                {memo?.valuation_metric ?? "—"}
              </p>

              <div className="relative mt-3 h-[3px] rounded-full bg-white/10">
                {pct !== null && (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-white/15"
                      style={{ width: `${pct}%` }}
                    />
                    <div
                      className={cn(
                        "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                        DOT_COLOR[verdict],
                      )}
                      style={{ left: `${pct}%` }}
                    />
                  </>
                )}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[9px] text-on-surface-variant/40">
                <span>
                  {c.range_low != null ? formatMarketPrice(c.range_low, c.market) : "—"}
                </span>
                <span>
                  {c.range_high != null ? formatMarketPrice(c.range_high, c.market) : "—"}
                </span>
              </div>

              <span
                className={cn(
                  "mt-3 inline-block rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest",
                  VERDICT_STYLE[verdict],
                )}
              >
                {verdict}
              </span>
              {memo?.tagline && (
                <p className="mt-1.5 text-[9px] uppercase tracking-wide text-on-surface-variant/50">
                  {memo.tagline}
                </p>
              )}
              {memo?.operational_share && (
                <p className="mt-2 inline-block rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-on-surface-variant/60">
                  {memo.operational_share}
                </p>
              )}
              {memo?.market_cap && (
                <p className="mt-1.5 font-mono text-[9px] text-on-surface-variant/40">
                  {memo.market_cap}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
