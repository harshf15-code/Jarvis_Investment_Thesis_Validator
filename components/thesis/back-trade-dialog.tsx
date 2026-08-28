"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import type { Memorandum } from "@/lib/jarvis-memorandum";
import type { ThesisCandidate } from "@/lib/types";

/**
 * The memo's one decision point: back the trade, or don't.
 *
 * Backing it is three writes that must happen together — promote the candidate
 * onto the thesis, lock Jarvis's numbers into a `trade_plans` row, then open
 * the position with its first entry. They run in that order because each is a
 * foreign key for the next; a failure part-way leaves the earlier writes in
 * place, which is recoverable (the thesis simply has a plan and no position)
 * where a position pointing at no plan would not be.
 *
 * Quantity and price are the trader's own — the fill they actually got, not the
 * entry zone Jarvis proposed. The zone is shown alongside as a reference.
 */
export function BackTradeDialog({
  thesisId,
  memo,
  candidate,
  onClose,
}: {
  thesisId: string;
  memo: Memorandum;
  /** The primary pick's persisted row — carries `stock_id` and live CMP. */
  candidate: ThesisCandidate;
  onClose: () => void;
}) {
  const router = useRouter();
  const n = memo.trade_plan.numeric;
  const symbol = candidate.exchange === "US" ? "$" : "₹";

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  // Seeded with live CMP as the most likely fill, but fully editable.
  const [price, setPrice] = useState(candidate.cmp != null ? String(candidate.cmp) : "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = Number(quantity);
  const px = Number(price);
  const valid = Number.isFinite(qty) && qty > 0 && Number.isFinite(px) && px > 0 && date !== "";

  async function submit() {
    if (!valid || !candidate.stock_id) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. The thesis now points at the name being backed.
      const promote = await fetch(`/api/theses/${thesisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_candidate_id: candidate.id, status: "active" }),
      });
      if (!promote.ok) {
        const body = await promote.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not attach the stock to this thesis.");
      }

      // 2. Lock the memo's numbers as the trade plan.
      const planRes = await fetch("/api/trade-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thesis_id: thesisId,
          entry_zone_low: n.entry_zone_low,
          entry_zone_high: n.entry_zone_high,
          add_tranche_low: n.add_tranche_low,
          add_tranche_high: n.add_tranche_high,
          stop_loss: n.stop_loss,
          target_1: n.target_1,
          target_2: n.target_2,
          position_size_pct: n.position_size_pct,
          time_exit_date: n.time_exit_date,
          time_exit_condition: n.time_exit_condition,
          ai_suggested: n,
        }),
      });
      const planBody = await planRes.json().catch(() => ({}));
      // 409 means this thesis already has a locked plan — reuse it rather than
      // blocking a second tranche on a trade that's already open.
      const tradePlanId =
        planRes.status === 409 ? planBody.tradePlanId : planBody.tradePlan?.id;
      if (!planRes.ok && planRes.status !== 409) {
        throw new Error(planBody.error ?? "Could not lock the trade plan.");
      }
      if (!tradePlanId) throw new Error("Trade plan was created but returned no id.");

      // 3. Open the position with this fill as its first entry.
      const posRes = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_plan_id: tradePlanId,
          thesis_id: thesisId,
          stock_id: candidate.stock_id,
          ticker: candidate.ticker,
          date,
          quantity: qty,
          price: px,
          tranche: "T1",
          notes: notes.trim() || undefined,
        }),
      });
      const posBody = await posRes.json().catch(() => ({}));
      if (!posRes.ok) throw new Error(posBody.error ?? "Could not log the position.");

      router.push(`/positions/${posBody.position.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const stop = n.stop_loss;
  const riskPerShare = stop != null && Number.isFinite(px) && px > 0 ? px - stop : null;
  const totalRisk = riskPerShare != null && Number.isFinite(qty) && qty > 0 ? riskPerShare * qty : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Back ${candidate.ticker}`}
        className="glass-panel custom-scrollbar relative max-h-full w-full max-w-lg overflow-y-auto rounded-xl p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full bg-white/5 p-2 text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface"
        >
          <X className="size-4" />
        </button>

        <p className="text-[10px] font-extrabold uppercase tracking-widest text-primary">
          Back this trade
        </p>
        <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-on-surface">
          {candidate.company_name ?? candidate.ticker}
        </h2>
        <p className="mt-0.5 font-mono text-xs text-on-surface-variant">
          {candidate.ticker}
          {candidate.exchange ? ` · ${candidate.exchange}` : ""}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-white/5 p-3 text-center">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
              Entry zone
            </p>
            <p className="mt-0.5 font-mono text-xs text-primary">
              {n.entry_zone_low != null && n.entry_zone_high != null
                ? `${symbol}${n.entry_zone_low}–${n.entry_zone_high}`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
              Stop
            </p>
            <p className="mt-0.5 font-mono text-xs text-error">
              {stop != null ? `${symbol}${stop}` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-on-surface-variant/60">
              Target 1
            </p>
            <p className="mt-0.5 font-mono text-xs text-primary">
              {n.target_1 != null ? `${symbol}${n.target_1}` : "—"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Fill price *
            </span>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="sunken rounded-lg px-3 py-2.5 font-mono text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Quantity *
            </span>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="sunken rounded-lg px-3 py-2.5 font-mono text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Date *
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="sunken rounded-lg px-3 py-2.5 font-mono text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-on-surface-variant/70">
              Notes
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="sunken rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>
        </div>

        {totalRisk != null && (
          <p className="mt-4 text-xs text-on-surface-variant">
            At this fill, a stop at{" "}
            <span className="font-mono text-error">
              {symbol}
              {stop}
            </span>{" "}
            risks{" "}
            <span className="font-mono text-on-surface">
              {symbol}
              {Math.abs(totalRisk).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>{" "}
            across {qty} share{qty === 1 ? "" : "s"}.
          </p>
        )}

        {!candidate.stock_id && (
          <p className="mt-4 rounded-lg bg-error-container px-4 py-3 text-sm text-error">
            This candidate never resolved to live market data, so it can&apos;t be tracked as a
            position.
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/5 px-5 py-2.5 text-sm font-bold text-on-surface/80 transition-colors hover:bg-white/10 hover:text-on-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || submitting || !candidate.stock_id}
            className="rounded-full bg-primary px-6 py-2.5 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            {submitting ? "Logging…" : `Log ${candidate.ticker} position`}
          </button>
        </div>
      </div>
    </div>
  );
}
