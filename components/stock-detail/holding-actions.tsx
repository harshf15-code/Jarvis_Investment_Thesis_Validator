"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { StockType } from "@/lib/types";

/**
 * Two symmetric type-toggle actions for the stock detail page's header, both
 * against `PATCH /api/stocks/[id]` (`app/api/stocks/[id]/route.ts`) — the
 * route Task 5 already implements and this task wires a dedicated frontend
 * control for:
 *
 * - watchlist -> holding (`ConvertToHoldingDialog`): collects shares/
 *   cost-basis/date-acquired in a dialog, then `PATCH`es
 *   `{ type: "holding", shares, cost_basis, date_acquired }` — all three
 *   required together in the same request per `UpdateStockInputSchema`'s
 *   `superRefine` (`lib/validation/schemas.ts`), which the route relies on
 *   to have a complete row to upsert into `holdings`.
 * - holding -> watchlist (`MoveToWatchlistDialog`): a plain confirm dialog
 *   (this is reversible, in-app data — not a destructive action warranting
 *   more than a simple confirm), then `PATCH`es `{ type: "watchlist" }`,
 *   which deletes the `holdings` row server-side.
 *
 * Follows `RunJarvisButton`/`FundamentalsPanel`'s fetch-then-
 * `router.refresh()` pattern rather than holding its own copy of `type`: on
 * success the parent server component (`app/(app)/stocks/[id]/page.tsx`)
 * re-fetches the stock and this re-renders from the new `type` prop.
 */

const inputClassName =
  "h-11 w-full rounded-t-lg border-0 border-b-2 border-b-transparent bg-surface-container-highest px-3 text-on-surface outline-none transition-colors placeholder:text-on-surface/40 focus:border-b-primary";

// Glassmorphism dialog surface per the design system: `surface-variant` @
// 0.8 opacity + 20px backdrop-blur, ambient shadow (`shadow-ambient`,
// defined in `tailwind.config.ts` as the spec's `0 20px 40px rgba(0,0,0,0.4)`),
// no border/ring. Overrides `DialogContent`'s shadcn defaults
// (`bg-popover`/`ring-1 ring-foreground/10`) — that ring was deliberately
// left as a per-usage override point by the Task 1 fix round, not stripped
// globally.
const glassDialogClassName =
  "border-0 ring-0 bg-surface-variant/80 text-on-surface shadow-ambient backdrop-blur-[20px]";

// Footer's default `bg-muted/50` is a shadcn neutral token that clashes with
// the glass surface's tint; flattened here rather than reintroducing a
// second tonal band inside an already-small dialog.
const glassFooterClassName = "bg-transparent";

function secondaryButtonClassName(extra?: string) {
  return cn(
    "h-11 rounded-xl bg-surface-container-highest px-4 text-sm font-medium text-on-surface/80 transition-colors hover:text-on-surface disabled:opacity-60",
    extra,
  );
}

const primaryButtonClassName =
  "h-11 rounded-xl bg-gradient-to-br from-primary to-primary-container px-6 text-sm font-medium text-on-primary transition-opacity disabled:opacity-60";

function ConvertToHoldingDialog({ stockId }: { stockId: string }) {
  const router = useRouter();

  const sharesId = useId();
  const costBasisId = useId();
  const dateAcquiredId = useId();

  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [dateAcquired, setDateAcquired] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/stocks/${stockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "holding",
          shares: Number(shares),
          cost_basis: Number(costBasis),
          date_acquired: dateAcquired,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" && payload.error) ||
          "Something went wrong. Please try again.";
        setError(message);
        return;
      }

      setOpen(false);
      setShares("");
      setCostBasis("");
      setDateAcquired("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={secondaryButtonClassName()}>
          Convert to Holding
        </button>
      </DialogTrigger>
      <DialogContent className={glassDialogClassName}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-on-surface">
              Convert to Holding
            </DialogTitle>
            <DialogDescription>
              Enter your position details to start tracking this as a
              holding.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={sharesId} className="text-on-surface">
              Shares
            </Label>
            <input
              id={sharesId}
              type="number"
              min="0"
              step="any"
              required
              autoFocus
              value={shares}
              onChange={(event) => setShares(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={costBasisId} className="text-on-surface">
              Cost basis (per share)
            </Label>
            <input
              id={costBasisId}
              type="number"
              min="0"
              step="any"
              required
              value={costBasis}
              onChange={(event) => setCostBasis(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dateAcquiredId} className="text-on-surface">
              Date acquired
            </Label>
            <input
              id={dateAcquiredId}
              type="date"
              required
              value={dateAcquired}
              onChange={(event) => setDateAcquired(event.target.value)}
              className={inputClassName}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}

          <DialogFooter className={glassFooterClassName}>
            <button
              type="submit"
              disabled={isSubmitting}
              className={primaryButtonClassName}
            >
              {isSubmitting ? "Converting…" : "Convert to Holding"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveToWatchlistDialog({ stockId }: { stockId: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/stocks/${stockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "watchlist" }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" && payload.error) ||
          "Something went wrong. Please try again.";
        setError(message);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={secondaryButtonClassName()}>
          Move back to Watchlist
        </button>
      </DialogTrigger>
      <DialogContent className={glassDialogClassName}>
        <DialogHeader>
          <DialogTitle className="text-on-surface">
            Move back to Watchlist?
          </DialogTitle>
          <DialogDescription>
            This clears the shares, cost basis, and date-acquired recorded
            for this position. The stock stays on your list as a watchlist
            entry — you can convert it back to a holding anytime.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        ) : null}

        <DialogFooter className={glassFooterClassName}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
            className={secondaryButtonClassName()}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={primaryButtonClassName}
          >
            {isSubmitting ? "Moving…" : "Move to Watchlist"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Entry point rendered on the stock detail page header: picks the correct
 * one of the two dialogs above based on the stock's current `type`.
 */
export function HoldingTypeAction({
  stockId,
  type,
}: {
  stockId: string;
  type: StockType;
}) {
  return type === "watchlist" ? (
    <ConvertToHoldingDialog stockId={stockId} />
  ) : (
    <MoveToWatchlistDialog stockId={stockId} />
  );
}
