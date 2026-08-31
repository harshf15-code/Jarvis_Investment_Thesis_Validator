"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { HoldingReadSchema, type HoldingLean } from "@/lib/holding-watch";
import type { HoldingReview, HoldingReviewTrigger } from "@/lib/types";

/**
 * Jarvis's reads on one holding — the latest expanded, the rest collapsed.
 *
 * Every document is re-validated on the way in, so a row written by an older
 * schema degrades to a labelled "couldn't read this" card rather than crashing
 * the page or, worse, rendering half a review as though it were whole. Same
 * discipline as the memorandum and the Council report.
 */

const TRIGGER_LABEL: Record<HoldingReviewTrigger, string> = {
  manual: "You asked",
  earnings_calendar: "Earnings date",
  fundamentals_delta: "Fundamentals moved",
  scheduled: "Scheduled check",
};

const LEAN_STYLE: Record<HoldingLean, string> = {
  STAY: "bg-status-green-container text-status-green",
  TRIM: "bg-primary-container text-primary",
  EXIT: "bg-error-container text-error",
  UNCLEAR: "bg-white/5 text-on-surface-variant",
};

export function HoldingReviewsPanel({
  positionId,
  reviews,
  /** An existing watch row that has never run — the initial read is queued. */
  queued,
  /**
   * Whether the SCHEDULED watch actually covers this position. v1 scopes it to
   * imported holdings, so a Jarvis-originated position can be re-read on
   * demand but will never be re-read on a schedule — and telling that trader
   * it is "re-checked weekly" would be a promise nothing keeps.
   */
  watched,
  onReviewed,
}: {
  positionId: string;
  reviews: HoldingReview[];
  queued: boolean;
  watched: boolean;
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${positionId}/review`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't run that read.");
      onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
            Jarvis on this holding
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            {watched
              ? "Re-checked weekly against the earnings calendar and this company's fundamentals."
              : "Run on demand. The weekly watch covers imported holdings only, so this one is re-read when you ask."}{" "}
            Not news — Jarvis has no feed and says so rather than inventing one.
          </p>
        </div>
        <button
          type="button"
          onClick={rerun}
          disabled={busy}
          className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Reading…" : "Re-run this read"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>
      )}

      {reviews.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          {queued
            ? "The first read is queued and will run shortly. Nothing has been skipped."
            : "No read yet. Run one whenever you want a second opinion on this holding."}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {reviews.map((review, i) => (
            <ReviewCard
              key={review.id}
              review={review}
              open={i === 0 || expanded === review.id}
              onToggle={() => setExpanded(expanded === review.id ? null : review.id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  open,
  onToggle,
}: {
  review: HoldingReview;
  open: boolean;
  onToggle: () => void;
}) {
  const parsed = HoldingReadSchema.safeParse(review.document);
  const date = review.created_at.slice(0, 10);

  if (!parsed.success) {
    return (
      <li className="sunken rounded-lg p-4">
        <p className="text-sm text-error">
          This read was written in an older format and can&apos;t be shown. Re-run it above.
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
          {date}
        </p>
      </li>
    );
  }

  const read = parsed.data;

  return (
    <li className="sunken rounded-lg p-4">
      <button type="button" onClick={onToggle} className="flex w-full flex-col gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 font-display text-[10px] font-black tracking-widest ${LEAN_STYLE[read.lean]}`}
          >
            {read.lean}
          </span>
          <span className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
            {date} · {TRIGGER_LABEL[review.trigger]}
          </span>
        </div>
        <p className="text-sm text-on-surface">{read.headline ?? "—"}</p>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-white/5 pt-3">
          {read.still_intact !== null && (
            <p className="text-xs">
              <span className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
                Your reason for holding
              </span>
              <br />
              <span className={read.still_intact ? "text-status-green" : "text-error"}>
                {read.still_intact ? "Still looks intact." : "Looks under pressure."}
              </span>
            </p>
          )}
          <Block label="What changed" body={read.what_changed} />
          <Block label="What to watch" body={read.what_to_watch} />
          {read.grounded_in.length > 0 && (
            <div>
              <p className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
                Grounded in
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {read.grounded_in.map((fact, i) => (
                  <li key={i} className="font-mono text-[11px] text-on-surface-variant">
                    {fact}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Block({ label, body }: { label: string; body: string | null }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm text-on-surface-variant">{body ?? "—"}</p>
    </div>
  );
}
