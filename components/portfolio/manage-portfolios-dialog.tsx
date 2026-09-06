"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { OwnershipBadge } from "@/components/portfolio/ownership-badge";
import { usePortfolios } from "@/components/layout/portfolio-context";
import { MAX_PORTFOLIOS } from "@/lib/portfolio/limits";
import type { Portfolio, PortfolioOwnership } from "@/lib/types";

/**
 * Create, rename, re-own and delete books.
 *
 * Deliberately not a screen. Managing portfolios is something a trader does
 * three times a year, and a nav entry for it would cost a permanent slot to buy
 * an occasional convenience — so it hangs off the switcher, which is where
 * anyone wondering about their books is already looking.
 */

/**
 * Whose money is this? Shared by the create form and every existing row, so the
 * question is asked with the same words and the same control in both places.
 *
 * It was once only in the create form, which meant ownership could be SET but
 * never CORRECTED: a book marked wrong at creation could only be fixed by
 * deleting it — which is refused the moment it holds anything — even though the
 * API had always accepted the change.
 */
function OwnershipFields({
  ownership,
  beneficiary,
  onOwnership,
  onBeneficiary,
  onBeneficiaryCommit,
  disabled,
  idPrefix,
}: {
  ownership: PortfolioOwnership;
  beneficiary: string;
  onOwnership: (value: PortfolioOwnership) => void;
  onBeneficiary: (value: string) => void;
  /** Called when the name should be saved. Omitted where a Create button saves. */
  onBeneficiaryCommit?: (value: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(["owned", "managed"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onOwnership(value)}
            aria-pressed={ownership === value}
            disabled={disabled}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              ownership === value
                ? "bg-primary text-on-primary"
                : "bg-white/5 text-on-surface-variant hover:bg-white/10"
            }`}
          >
            {value === "owned" ? "My money" : "I manage it for someone"}
          </button>
        ))}
      </div>
      {ownership === "managed" && (
        <input
          id={`${idPrefix}-beneficiary`}
          value={beneficiary}
          onChange={(e) => onBeneficiary(e.target.value)}
          onBlur={(e) => onBeneficiaryCommit?.(e.target.value)}
          placeholder="Whose money is it? — e.g. Mom"
          maxLength={60}
          disabled={disabled}
          aria-label="Whose money is it?"
          className="rounded-lg bg-surface-container-low px-3 py-2 text-sm"
        />
      )}
    </>
  );
}

export function ManagePortfoliosDialog({ onClose }: { onClose: () => void }) {
  const { portfolios, active, refresh, select } = usePortfolios();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [ownership, setOwnership] = useState<PortfolioOwnership>("owned");
  const [beneficiary, setBeneficiary] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which existing row has its "whose money" panel open, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The beneficiary being typed, keyed by portfolio. Uncommitted until blur. */
  const [draftBeneficiary, setDraftBeneficiary] = useState<Record<string, string>>({});

  const atCap = portfolios.length >= MAX_PORTFOLIOS;

  async function send(url: string, init: RequestInit, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? failure);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function patch(portfolio: Portfolio, body: Record<string, unknown>, failure: string) {
    return send(
      `/api/portfolios/${portfolio.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      failure,
    );
  }

  async function create() {
    const ok = await send(
      "/api/portfolios",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ownership,
          beneficiary_name: ownership === "managed" ? beneficiary : null,
          base_currency: currency,
        }),
      },
      "Could not create that portfolio.",
    );
    if (ok) {
      setCreating(false);
      setName("");
      setBeneficiary("");
      setOwnership("owned");
    }
  }

  async function rename(portfolio: Portfolio, next: string) {
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === portfolio.name) return;
    await patch(portfolio, { name: trimmed }, "Could not rename that portfolio.");
  }

  /**
   * Saved the moment it is chosen, like the rename beside it — there is no Save
   * button to press and nothing to forget. Switching a book back to your own
   * money clears its beneficiary SERVER-SIDE, so the two fields cannot end up
   * disagreeing about whose money it is.
   */
  async function setOwnershipFor(portfolio: Portfolio, value: PortfolioOwnership) {
    if (value === portfolio.ownership) return;
    await patch(portfolio, { ownership: value }, "Could not change whose money that is.");
  }

  async function setBeneficiaryFor(portfolio: Portfolio, value: string) {
    const trimmed = value.trim();
    if (trimmed === (portfolio.beneficiary_name ?? "")) return;
    await patch(portfolio, { beneficiary_name: trimmed }, "Could not save that name.");
  }

  async function remove(portfolio: Portfolio) {
    const ok = await send(
      `/api/portfolios/${portfolio.id}`,
      { method: "DELETE" },
      "Could not delete that portfolio.",
    );
    // Deleting the book you are LOOKING AT leaves its id in `?portfolio=`, and
    // the URL is the state — so the next read is scoped to a book that no
    // longer exists, and the switcher shows nothing active. Move to the default
    // first; the refresh then lands on a URL that names a real book.
    if (ok && active?.id === portfolio.id) {
      const fallback = portfolios.find((p) => p.is_default && p.id !== portfolio.id);
      if (fallback) select(fallback.id);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl bg-surface-container-low p-6 shadow-ambient">
        <h2 className="font-display text-lg text-on-surface">Your portfolios</h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          Up to {MAX_PORTFOLIOS}. A managed portfolio is money you run for someone else — Jarvis is
          told so, and it stays out of your own totals.
        </p>

        <div className="mt-4 flex flex-col gap-1">
          {portfolios.map((p) => (
            <div key={p.id} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
              <div className="flex items-center gap-2">
                {/* Rename in place on blur. A separate edit mode for one text
                    field is a step that exists only to be dismissed. */}
                <input
                  defaultValue={p.name}
                  onBlur={(e) => void rename(p, e.target.value)}
                  disabled={busy}
                  aria-label={`Rename ${p.name}`}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-on-surface outline-none focus:bg-surface-container-highest"
                />
                {/* Whose money it is, always visible and always clickable —
                    including when the answer is "mine". `OwnershipBadge`
                    deliberately renders nothing for an owned book, which is
                    right on a dashboard and wrong here: on the one screen for
                    changing the answer, a book with no badge would look like a
                    book with no setting. */}
                <button
                  type="button"
                  onClick={() => setEditing(editing === p.id ? null : p.id)}
                  disabled={busy}
                  aria-expanded={editing === p.id}
                  aria-label={`Change whose money ${p.name} is`}
                  className="shrink-0 rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {p.ownership === "managed" ? (
                    <OwnershipBadge portfolio={p} />
                  ) : (
                    <span className="block rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                      My money
                    </span>
                  )}
                </button>
                <span className="shrink-0 font-mono text-[10px] text-on-surface-variant">
                  {p.base_currency}
                </span>
                {p.is_default ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-on-surface-variant">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void remove(p)}
                    disabled={busy}
                    aria-label={`Delete ${p.name}`}
                    className="shrink-0 rounded p-1 text-on-surface-variant transition-colors hover:text-status-red disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              {editing === p.id && (
                <div className="mt-2 mb-1 flex flex-col gap-2 rounded-lg bg-surface-container-highest p-3">
                  <p className="text-[11px] text-on-surface-variant">
                    Whose money is in {p.name}?
                  </p>
                  <OwnershipFields
                    idPrefix={p.id}
                    ownership={p.ownership}
                    beneficiary={draftBeneficiary[p.id] ?? p.beneficiary_name ?? ""}
                    onOwnership={(value) => void setOwnershipFor(p, value)}
                    onBeneficiary={(value) =>
                      setDraftBeneficiary((d) => ({ ...d, [p.id]: value }))
                    }
                    onBeneficiaryCommit={(value) => void setBeneficiaryFor(p, value)}
                    disabled={busy}
                  />
                  <p className="text-[11px] text-on-surface-variant">
                    {p.ownership === "managed"
                      ? "Kept out of your own headline total, and every Jarvis review of it is told it is reviewing someone else's capital."
                      : "Counted in your own totals."}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {creating ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg bg-surface-container-highest p-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Portfolio name — e.g. Mom's retirement"
              maxLength={60}
              className="rounded-lg bg-surface-container-low px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-start gap-2">
              <OwnershipFields
                idPrefix="new"
                ownership={ownership}
                beneficiary={beneficiary}
                onOwnership={setOwnership}
                onBeneficiary={setBeneficiary}
                disabled={busy}
              />
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                aria-label="Base currency"
                className="w-20 rounded-full bg-white/5 px-3 py-1.5 text-center font-mono text-xs uppercase"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl px-3 py-1.5 text-xs text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy || name.trim() === ""}
                className="rounded-xl bg-primary px-4 py-1.5 text-xs font-medium text-on-primary disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={atCap}
            title={atCap ? `You already have ${MAX_PORTFOLIOS} portfolios.` : undefined}
            className="mt-4 flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            New portfolio
          </button>
        )}

        {error && <p className="mt-3 text-sm text-status-red">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-on-surface/60">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
