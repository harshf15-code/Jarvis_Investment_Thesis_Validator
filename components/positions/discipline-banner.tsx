"use client";

import { formatCurrency } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/** Spec US-04. Blocking red banner when at/through stop; non-blocking amber toast-style bar when a target has been reached but not yet trimmed. */
export function DisciplineBanner({
  ticker,
  currentPrice,
  exchange,
  stopLoss,
  target1,
  t1Trimmed,
  onExitNow,
  onLogTrim,
}: {
  ticker: string;
  currentPrice: number | null;
  exchange: ExchangeCode;
  stopLoss: number | null;
  target1: number | null;
  t1Trimmed: boolean;
  onExitNow: () => void;
  onLogTrim: () => void;
}) {
  if (currentPrice === null) return null;

  if (stopLoss !== null && currentPrice <= stopLoss) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl bg-status-red-container px-4 py-3">
        <span className="text-sm font-medium text-status-red">
          Stop Hit — {ticker} at {formatCurrency(currentPrice, exchange)}. Exit required.
        </span>
        <button type="button" onClick={onExitNow} className="rounded-lg bg-status-red px-3 py-1.5 text-xs font-medium text-on-primary">
          Exit Now
        </button>
      </div>
    );
  }

  if (!t1Trimmed && target1 !== null && currentPrice >= target1) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl bg-primary-container px-4 py-3">
        <span className="text-sm font-medium text-primary">T1 Hit — {ticker}. Trim 40%?</span>
        <div className="flex gap-2">
          <button type="button" onClick={onLogTrim} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary">
            Confirm
          </button>
        </div>
      </div>
    );
  }

  return null;
}
