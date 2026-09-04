"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

import {
  MIN_PATTERN_HOLDINGS,
  PatternReadSchema,
  unplacedTickers,
  type PatternRead,
} from "@/lib/jarvis-scratchpad";
import { FiduciaryNote } from "@/components/portfolio/fiduciary-note";
import type { Portfolio, PortfolioPatternReadRow } from "@/lib/types";

/**
 * "What Jarvis sees" — the pattern read, latest expanded and priors collapsed.
 *
 * The list idiom is `HoldingReviewsPanel`'s, deliberately: one nullable
 * `expanded` id, and index 0 always open. The newest read is the answer; the
 * rest are the record of how a trader's taste moved, which is the only reason
 * this table is append-only.
 */
export function PatternReadPanel({
  reads,
  nextBefore,
  heldTickers,
  portfolio,
  onRead,
  onLoadedOlder,
  onAcceptSuggestion,
}: {
  reads: PortfolioPatternReadRow[];
  nextBefore: string | null;
  heldTickers: string[];
  /** The book being read. Null in the roll-up, where a pattern read is not
   *  offered: a claim about the trader's taste that blends in a book run for
   *  someone else describes a person who does not exist. */
  portfolio: Portfolio | null;
  onRead: (read: PortfolioPatternReadRow) => void;
  onLoadedOlder: (older: PortfolioPatternReadRow[], before: string | null) => void;
  onAcceptSuggestion: (body: string, ticker: string | null) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portfolioId = portfolio?.id ?? null;
  const enoughHoldings = heldTickers.length >= MIN_PATTERN_HOLDINGS && portfolioId !== null;

  async function run() {
    if (!portfolioId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scratchpad/pattern?portfolio=${portfolioId}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't read your pattern.");
      onRead(body.read);
      setExpanded(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function loadOlder() {
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/scratchpad/pattern?portfolio=${portfolioId ?? "all"}&before=${encodeURIComponent(nextBefore!)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't load older reads.");
      onLoadedOlder(body.reads ?? [], body.nextBefore ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-xl p-5">
      <FiduciaryNote portfolio={portfolio} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-primary">
            What Jarvis sees
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            One read of everything you own, on demand. What is fact is fetched; what pattern
            those facts form is Jarvis&rsquo;s opinion, and it is labelled as one.
          </p>
        </div>
        {enoughHoldings && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Sparkles className="size-3.5" />
            {busy ? "Reading…" : reads.length > 0 ? "Read again" : "Read my pattern"}
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">{error}</p>}

      {!enoughHoldings ? (
        <p className="text-sm text-on-surface-variant">
          A pattern needs at least {MIN_PATTERN_HOLDINGS} different holdings to be a pattern
          rather than a coincidence. You have {heldTickers.length}. Open more positions, or
          import the ones you already own.
        </p>
      ) : reads.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          No read yet. Jarvis will group what you own by what it can actually check — sector,
          the reason you gave, what your theses claimed — and say what runs through it.
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {reads.map((read, i) => (
              <ReadCard
                key={read.id}
                read={read}
                heldTickers={heldTickers}
                open={i === 0 || expanded === read.id}
                onToggle={() => setExpanded(expanded === read.id ? null : read.id)}
                onAcceptSuggestion={onAcceptSuggestion}
              />
            ))}
          </ol>
          {nextBefore && (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingMore}
              className="self-start text-xs text-on-surface-variant underline transition-colors hover:text-on-surface disabled:opacity-40"
            >
              {loadingMore ? "Loading…" : "Load older reads"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ReadCard({
  read,
  heldTickers,
  open,
  onToggle,
  onAcceptSuggestion,
}: {
  read: PortfolioPatternReadRow;
  heldTickers: string[];
  open: boolean;
  onToggle: () => void;
  onAcceptSuggestion: (body: string, ticker: string | null) => Promise<void>;
}) {
  const date = read.created_at.slice(0, 10);
  // Validated on read, so a row written by an older schema degrades to "read
  // again" rather than rendering half a pattern or crashing the page.
  const parsed = PatternReadSchema.safeParse(read.document);

  if (!parsed.success) {
    return (
      <li className="rounded-lg bg-white/5 p-3">
        <p className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
          {date}
        </p>
        <p className="mt-1 text-sm text-on-surface-variant">
          This read was written in an older format and can&rsquo;t be shown. Read again above.
        </p>
      </li>
    );
  }

  const document: PatternRead = parsed.data;
  const reviewed = reviewedTickers(read.holdings_snapshot);
  const stale = reviewed !== null && !sameSet(reviewed, heldTickers);
  // Computed against what the read actually reviewed, not against today's book:
  // an old read's honesty is about the holdings it saw.
  const unplaced = unplacedTickers(document, reviewed ?? heldTickers);

  return (
    <li className="rounded-lg bg-white/5 p-3">
      <button type="button" onClick={onToggle} className="flex w-full flex-col gap-1.5 text-left">
        <span className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
          {date}
        </span>
        <span className="text-sm text-on-surface">{document.headline ?? "—"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-white/5 pt-3">
          {stale && (
            <p className="rounded-lg bg-status-blue-container px-3 py-2 text-xs text-status-blue">
              Your holdings have changed since this read. It describes the book as it was on{" "}
              {date}, not the one you hold now.
            </p>
          )}

          {document.signals.map((signal) => (
            <div key={signal.theme}>
              <p className="text-sm text-on-surface">{signal.theme}</p>
              <p className="mt-0.5 font-mono text-[10px] tracking-wider text-primary uppercase">
                {signal.tickers.join(" · ")}
              </p>
              {signal.note && (
                <p className="mt-1 text-xs text-on-surface-variant">{signal.note}</p>
              )}
              {signal.also_look_at && (
                <Suggestion
                  text={signal.also_look_at}
                  theme={signal.theme}
                  date={date}
                  onAccept={onAcceptSuggestion}
                />
              )}
            </div>
          ))}

          {/* Computed from the signals rather than taken from the model's own
              prose — a model that has just told a tidy story is the last thing
              to ask which holdings spoil it. Its account of WHY sits below. */}
          {unplaced.length > 0 && (
            <div>
              <p className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
                Doesn&rsquo;t fit any pattern
              </p>
              <p className="mt-1 font-mono text-xs text-on-surface-variant">
                {unplaced.join(" · ")}
              </p>
              {document.not_explained && (
                <p className="mt-1 text-xs text-on-surface-variant">{document.not_explained}</p>
              )}
            </div>
          )}

          {document.grounded_in.length > 0 && (
            <div>
              <p className="font-mono text-[10px] tracking-wider text-on-surface-variant/60 uppercase">
                Grounded in
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {document.grounded_in.map((fact, i) => (
                  <li key={`${fact}-${i}`} className="text-xs text-on-surface-variant">
                    — {fact}
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

/**
 * A prompt the trader can keep. Never created automatically — the PRD is
 * explicit that a suggestion becomes a note only when someone clicks.
 */
function Suggestion({
  text,
  theme,
  date,
  onAccept,
}: {
  text: string;
  theme: string;
  date: string;
  onAccept: (body: string, ticker: string | null) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-2">
      <p className="flex-1 text-xs text-on-surface-variant/70 italic">{text}</p>
      <button
        type="button"
        disabled={saving || saved}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            // No ticker: a suggestion may name a sector or a question rather
            // than a symbol, and guessing one would tag the note wrongly.
            await onAccept(`${text}\n\n— from Jarvis's read on ${date}, on "${theme}"`, null);
            setSaved(true);
          } catch (err) {
            // Without this the rejection is swallowed and the button simply
            // re-enables, which reads as "nothing happened" rather than "that
            // did not save" — the note is lost and the trader is not told.
            setError(err instanceof Error ? err.message : "Couldn't save that note. Try again.");
          } finally {
            setSaving(false);
          }
        }}
        className="rounded-full bg-white/5 px-3 py-1 text-[10px] text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface disabled:opacity-40"
      >
        {saved ? "Noted" : saving ? "Saving…" : "+ note this"}
      </button>
      {error && <p className="w-full text-xs text-error">{error}</p>}
    </div>
  );
}

/** The tickers a stored read actually reviewed, or null if the shape is old. */
function reviewedTickers(snapshot: unknown): string[] | null {
  const holdings = (snapshot as { holdings?: unknown } | null)?.holdings;
  if (!Array.isArray(holdings)) return null;
  return holdings
    .map((h) => (h as { ticker?: unknown }).ticker)
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toUpperCase());
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}
