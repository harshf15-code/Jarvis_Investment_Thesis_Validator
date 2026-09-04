"use client";

import { usePortfolios } from "@/components/layout/portfolio-context";
import { OwnershipBadge } from "@/components/portfolio/ownership-badge";

/**
 * "Which book is this going in?" — asked every time, with nothing pre-selected.
 *
 * NOT pre-filled with the book currently on screen, and not skipped when the
 * trader has only one. Both would be reasonable conveniences and both would
 * make this control invisible, which defeats it: the failure this exists to
 * prevent is a share filed against the wrong person's money by someone who was
 * moving fast and did not read the form. A control that answers itself is not
 * a control.
 *
 * The caller keeps the value and disables its own submit until there is one, so
 * the refusal reads as "you have not finished" rather than as an error.
 */
export function PortfolioPicker({
  value,
  onChange,
  label = "Which portfolio is this in?",
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
  /** Set while work is already running against the chosen book — see the
   *  import wizard, where a mid-flight change would preview one book and
   *  commit into another. */
  disabled?: boolean;
}) {
  const { portfolios, loading, error } = usePortfolios();

  if (error) {
    return <p className="text-xs text-status-red">Could not load your portfolios: {error}</p>;
  }
  if (loading && portfolios.length === 0) {
    return <p className="text-xs text-on-surface-variant">Loading your portfolios…</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {portfolios.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            aria-pressed={value === p.id}
            disabled={disabled}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              value === p.id
                ? "bg-primary text-on-primary"
                : "bg-white/5 text-on-surface-variant hover:bg-white/10 hover:text-on-surface"
            }`}
          >
            <span className="max-w-[18ch] truncate">{p.name}</span>
            {/* Shown on the SELECTED book too. Hiding it once chosen removed
                the "someone else's money" label at the one moment it decides
                anything — the second before a trade is filed. */}
            <OwnershipBadge portfolio={p} />
          </button>
        ))}
      </div>
    </div>
  );
}
