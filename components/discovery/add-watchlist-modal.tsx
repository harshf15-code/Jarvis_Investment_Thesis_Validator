// components/discovery/add-watchlist-modal.tsx
"use client";

import { useState } from "react";
import type { ExchangeCode } from "@/lib/types";

/** Spec US-21: ticker only, no thesis required. */
export function AddWatchlistModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState<ExchangeCode>("NSE");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, market, watching_only: true }),
      });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="mb-4 font-display text-lg text-on-surface">Add to Watchlist</h2>
        <div className="mb-4 flex flex-col gap-3">
          <input placeholder="Ticker" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm" />
          <select value={market} onChange={(e) => setMarket(e.target.value as ExchangeCode)} className="rounded-lg bg-surface-container-highest px-3 py-2 text-sm">
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
            <option value="US">US</option>
          </select>
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={submitting || !ticker.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
