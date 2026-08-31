"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { COUNCIL_CONSULT_MIN } from "@/lib/jarvis-council";
import { cn } from "@/lib/utils";
import type { CouncilMember } from "@/lib/types";
import { CouncilDisclaimer } from "./disclaimer";

/**
 * The picker that stands between "Consult Investment Council" and N+1 model
 * calls billed to the trader's own OpenRouter key.
 *
 * It states the call count as the selection changes rather than gating a large
 * panel behind a warning: the trader is the one paying, so the number is
 * information they should have, not a decision to take away from them.
 *
 * Shared by both consult surfaces. The thesis Council and the portfolio
 * Council pick from the SAME roster with the same minimum and the same
 * disclaimer — only the copy and which slice of the spend ledger prices the
 * estimate differ, so those are props rather than a second component.
 */
export function ConsultDialog({
  onClose,
  onConfirm,
  eyebrow = "Second opinion",
  title = "Consult Investment Council",
  blurb = "Each member reads this memorandum and the whole priced field, then gives their own verdict — including naming a different winner.",
  /** Ledger prefix the cost estimate is averaged over. */
  featurePrefix = "council_",
  /** An extra line under the call count — e.g. work that is not a model call. */
  costNote,
}: {
  onClose: () => void;
  onConfirm: (memberIds: string[]) => void;
  eyebrow?: string;
  title?: string;
  blurb?: string;
  featurePrefix?: string;
  costNote?: string;
}) {
  const [members, setMembers] = useState<CouncilMember[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Average cost of one council call, from THIS trader's own ledger. Null until
   * they have run enough calls for an average to mean anything — a made-up
   * number next to a spend decision is worse than no number.
   */
  const [costPerCall, setCostPerCall] = useState<number | null>(null);
  const [overBudget, setOverBudget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/council/members");
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load your roster.");
        const list: CouncilMember[] = body.members ?? [];
        setMembers(list);

        // Price the consult from the trader's own recent calls rather than a
        // guess. Failing to load this costs the estimate, never the picker.
        try {
          const usageRes = await fetch("/api/usage");
          const usage = await usageRes.json();
          if (!cancelled && usageRes.ok) {
            const council = (usage.byFeature ?? []).filter((f: { feature: string }) =>
              f.feature.startsWith(featurePrefix),
            );
            const calls = council.reduce((n: number, f: { calls: number }) => n + f.calls, 0);
            const spent = council.reduce((n: number, f: { costUsd: number }) => n + f.costUsd, 0);
            // Below a handful of calls the mean is noise, not an estimate.
            if (calls >= 3) setCostPerCall(spent / calls);
            const { limits, daily_spent, monthly_spent } = usage;
            if (
              (limits?.daily != null && daily_spent >= limits.daily) ||
              (limits?.monthly != null && monthly_spent >= limits.monthly)
            ) {
              setOverBudget("You're at your analysis budget — a consult will be refused.");
            }
          }
        } catch {
          // No estimate. The call count alone is still shown.
        }
        // Pre-select the first three so the common case is one click. Still an
        // explicit confirmation — nothing runs until the trader says so.
        setSelected(list.slice(0, COUNCIL_CONSULT_MIN).map((m) => m.id));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [featurePrefix]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const short = COUNCIL_CONSULT_MIN - selected.length;
  const ready = short <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Consult Investment Council"
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
          {eyebrow}
        </p>
        <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-on-surface">
          {title}
        </h2>
        <p className="mt-1.5 text-xs text-on-surface-variant">{blurb}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
        )}

        {members === null && !error && (
          <p className="mt-5 text-xs text-on-surface-variant">Loading your roster…</p>
        )}

        {members !== null && members.length < COUNCIL_CONSULT_MIN && (
          <div className="mt-5 rounded-lg bg-status-blue-container px-4 py-3 text-xs text-status-blue">
            A council needs at least {COUNCIL_CONSULT_MIN} members and your roster has{" "}
            {members.length}.{" "}
            <Link href="/settings" className="underline">
              Add more in Settings
            </Link>
            .
          </div>
        )}

        {members !== null && members.length >= COUNCIL_CONSULT_MIN && (
          <>
            <ul className="mt-5 flex flex-col gap-2">
              {members.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <li key={m.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                        on
                          ? "border-primary/50 bg-primary/5"
                          : "border-white/10 hover:border-white/25",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(m.id)}
                        className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0">
                        <span className="block font-display text-sm font-bold tracking-tight text-on-surface">
                          {m.name}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-on-surface-variant">
                          {m.philosophy}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 font-mono text-[11px] text-on-surface-variant/70">
              {ready ? (
                <>
                  {selected.length} member{selected.length === 1 ? "" : "s"} →{" "}
                  {selected.length + 1} model calls
                  {costPerCall !== null &&
                    `, ≈ $${((selected.length + 1) * costPerCall).toFixed(2)}`}
                  .
                </>
              ) : (
                `Select ${short} more — a council is at least ${COUNCIL_CONSULT_MIN}.`
              )}
            </p>

            {costNote && ready && (
              <p className="mt-1.5 text-[11px] text-on-surface-variant/70">{costNote}</p>
            )}

            {overBudget && (
              <p className="mt-2 rounded-lg bg-error-container px-3 py-2 text-[11px] text-error">
                {overBudget}
              </p>
            )}

            <CouncilDisclaimer className="mt-3" />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-white/5 px-5 py-2.5 text-sm font-bold text-on-surface/80 transition-colors hover:bg-white/10 hover:text-on-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onConfirm(selected)}
                disabled={!ready}
                className="rounded-full bg-primary px-6 py-2.5 font-display text-sm font-extrabold tracking-tight text-on-primary shadow-ambient transition-all hover:bg-primary-dim active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
              >
                {ready ? `Consult ${selected.length} members` : "Consult"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
