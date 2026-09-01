"use client";

import { useState } from "react";
import { Target } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import {
  validateApprovedLevels,
  type ExitPlanLevels,
  type ExitPlanProposal,
} from "@/lib/exit-plan";
import type { TradePlan } from "@/lib/types";

/**
 * "Your exit plan" for an imported holding.
 *
 * A CSV carries the ticker, the quantity and the cost, so the `trade_plans` row
 * behind an imported position is written all-null — which is the entire reason
 * every rung of the Exit Ladder above reads PENDING and `poll-prices` has
 * nothing to alert on. This panel is where that gets filled in.
 *
 * Deliberately two steps. Jarvis proposes, the trader edits anything they
 * disagree with, and only then does a number reach the database. A stop that
 * appeared without anyone approving it is an auto-fill, and an auto-filled stop
 * is one nobody will honour when it fires.
 *
 * Rendered for imported holdings only. A Jarvis-originated position already has
 * a plan built from its memorandum; the route refuses to overwrite it.
 */

type Proposal = {
  proposal: ExitPlanProposal;
  currentPrice: number;
  currency: string;
  quantity: number;
};

/** The form's own state — strings, because a half-typed number is a string. */
type Draft = { stop_loss: string; target_1: string; target_2: string; time_exit_date: string };

const toDraft = (p: ExitPlanProposal): Draft => ({
  stop_loss: p.stop_loss != null ? String(p.stop_loss) : "",
  target_1: p.target_1 != null ? String(p.target_1) : "",
  target_2: p.target_2 != null ? String(p.target_2) : "",
  time_exit_date: p.time_exit_date ?? "",
});

/** Blank means "no level", not zero — the columns are nullable for a reason. */
function num(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function ExitPlanPanel({
  positionId,
  ticker,
  tradePlan,
  currency,
  hasRationale,
  onSaved,
}: {
  positionId: string;
  ticker: string;
  tradePlan: TradePlan;
  currency: string;
  /** `statedRationale(...) !== null` — Jarvis has something to anchor a stop to. */
  hasRationale: boolean;
  onSaved: () => void;
}) {
  const [proposed, setProposed] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levelsSet =
    tradePlan.stop_loss != null || tradePlan.target_1 != null || tradePlan.target_2 != null;
  const edited = new Set(tradePlan.edited_fields ?? []);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${positionId}/exit-plan`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't build a plan.");
      setProposed(body);
      setDraft(toDraft(body.proposal));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!proposed || !draft) return;
    const approved: ExitPlanLevels = {
      stop_loss: num(draft.stop_loss),
      target_1: num(draft.target_1),
      target_2: num(draft.target_2),
      time_exit_date: draft.time_exit_date.trim() || null,
      time_exit_condition: draft.time_exit_date.trim()
        ? proposed.proposal.time_exit_condition
        : null,
    };
    // Checked here as well as on the route so a typo is answered instantly
    // rather than after a round trip. The route stays the authority.
    const valid = validateApprovedLevels(approved);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = proposed.proposal;
      const res = await fetch(`/api/positions/${positionId}/exit-plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved,
          proposed: {
            stop_loss: p.stop_loss,
            target_1: p.target_1,
            target_2: p.target_2,
            time_exit_date: p.time_exit_date,
            time_exit_condition: p.time_exit_condition,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't save those levels.");
      setProposed(null);
      setDraft(null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // What the stop actually costs, at the quantity still held. The same
  // arithmetic the back-trade dialog shows before a position is opened — the
  // number that makes a stop a decision rather than a field.
  const stopValue = draft ? num(draft.stop_loss) : null;
  const risk =
    proposed && stopValue != null && Number.isFinite(stopValue)
      ? (proposed.currentPrice - stopValue) * proposed.quantity
      : null;

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
            Your exit plan
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            The stop and targets the ladder above tracks, and the levels the price
            watch alerts you on.
          </p>
        </div>
        {!proposed && !levelsSet && hasRationale && (
          <button
            type="button"
            onClick={build}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Target className="size-3.5" />
            {busy ? "Building…" : "Build Exit Plan"}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
      )}

      {proposed && draft ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-white/5 px-4 py-3 text-xs leading-relaxed text-on-surface-variant">
            Jarvis built these from one thing you wrote and today&rsquo;s price and
            fundamentals — not a full comparative analysis, no chart, no news, no
            earnings call. Treat them as a starting point you argue with. Change any
            number before you save; nothing is written until you do.
          </p>

          <div className="flex flex-col gap-3">
            <LevelField
              label="Stop"
              hint={proposed.proposal.reasoning.stop_loss}
              value={draft.stop_loss}
              onChange={(v) => setDraft({ ...draft, stop_loss: v })}
            />
            <LevelField
              label="Target 1"
              hint={proposed.proposal.reasoning.target_1}
              value={draft.target_1}
              onChange={(v) => setDraft({ ...draft, target_1: v })}
            />
            <LevelField
              label="Target 2"
              hint={proposed.proposal.reasoning.target_2}
              value={draft.target_2}
              onChange={(v) => setDraft({ ...draft, target_2: v })}
            />
            <LevelField
              label="Time exit"
              type="date"
              hint={proposed.proposal.reasoning.time_exit}
              value={draft.time_exit_date}
              onChange={(v) => setDraft({ ...draft, time_exit_date: v })}
            />
          </div>

          <p className="text-xs text-on-surface-variant">
            {ticker} trades at{" "}
            <span className="font-mono text-on-surface">
              {formatCurrency(proposed.currentPrice, proposed.currency)}
            </span>
            {risk != null && risk > 0 && (
              <>
                . That stop risks{" "}
                <span className="font-mono text-error">
                  {formatCurrency(risk, proposed.currency)}
                </span>{" "}
                across the {proposed.quantity} share
                {proposed.quantity === 1 ? "" : "s"} you still hold
              </>
            )}
            .
          </p>

          {proposed.proposal.grounded_in.length > 0 && (
            <div>
              <p className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
                Built from
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {proposed.proposal.grounded_in.map((fact) => (
                  <li key={fact} className="text-xs text-on-surface-variant">
                    — {fact}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save these levels"}
            </button>
            <button
              type="button"
              onClick={() => {
                setProposed(null);
                setDraft(null);
                setError(null);
              }}
              disabled={busy}
              className="rounded-full px-4 py-2 text-xs text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              Discard
            </button>
          </div>
        </div>
      ) : levelsSet ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-white/5 p-3 text-center">
            <SavedLevel label="Stop" value={tradePlan.stop_loss} currency={currency} edited={edited.has("stop_loss")} tone="text-error" />
            <SavedLevel label="Target 1" value={tradePlan.target_1} currency={currency} edited={edited.has("target_1")} tone="text-primary" />
            <SavedLevel label="Target 2" value={tradePlan.target_2} currency={currency} edited={edited.has("target_2")} tone="text-primary" />
          </div>
          {tradePlan.time_exit_date && (
            <p className="text-xs text-on-surface-variant">
              Time exit{" "}
              <span className="font-mono text-on-surface">{tradePlan.time_exit_date}</span>
              {tradePlan.time_exit_condition ? ` — ${tradePlan.time_exit_condition}` : ""}
            </p>
          )}
          <p className="text-xs text-on-surface-variant/70">
            The ladder above now tracks these, and the price watch will flag a breach.
            An asterisk marks a level you changed from what Jarvis proposed.
          </p>
        </div>
      ) : hasRationale ? (
        <p className="text-sm text-on-surface-variant">
          No stop or targets yet — that is why every rung above reads PENDING and
          nothing will alert you if {ticker} breaks down. Jarvis can propose levels
          from the reason you recorded; you approve them before anything saves.
        </p>
      ) : (
        <p className="text-sm text-on-surface-variant">
          Jarvis needs your reason before it can propose a stop. Add it above — a
          level anchored to nothing but today&rsquo;s price is a number, not a plan.
        </p>
      )}
    </div>
  );
}

function LevelField({
  label,
  hint,
  value,
  onChange,
  type = "number",
}: {
  label: string;
  hint: string | null;
  value: string;
  onChange: (value: string) => void;
  type?: "number" | "date";
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-wider text-on-surface-variant/70 uppercase">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === "number" ? "None" : ""}
        className="sunken rounded-lg px-3.5 py-2.5 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
      />
      {hint && <span className="text-xs text-on-surface-variant">{hint}</span>}
    </label>
  );
}

function SavedLevel({
  label,
  value,
  currency,
  edited,
  tone,
}: {
  label: string;
  value: number | null;
  currency: string;
  edited: boolean;
  tone: string;
}) {
  return (
    <div>
      <p className="font-mono text-[9px] tracking-widest text-on-surface-variant/60 uppercase">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-xs ${tone}`}>
        {value != null ? formatCurrency(value, currency) : "—"}
        {edited && value != null && (
          <span title="You changed this from what Jarvis proposed" className="text-on-surface-variant">
            *
          </span>
        )}
      </p>
    </div>
  );
}
