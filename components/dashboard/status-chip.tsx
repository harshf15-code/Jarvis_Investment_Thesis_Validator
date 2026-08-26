import { cn } from "@/lib/utils";

/**
 * The six PRD-defined watchlist statuses. `stocks.status` (`lib/types.ts`)
 * is a bare `text` column — nothing upstream guarantees its raw value
 * matches this union exactly (today it's always the DB default `"watching"`,
 * lowercase; later Edge Functions tasks will start writing real derived
 * statuses, in a format not yet nailed down). `StatusChip` accepts that raw
 * `string` and normalizes it against this union itself, rather than trusting
 * the caller to have already validated it.
 */
export type StockStatus =
  | "Watching"
  | "In Entry Zone"
  | "Holding"
  | "Stop Hit"
  | "Trim Hit"
  | "Reassess Due";

/**
 * Palette decisions (see task-6-report.md for the full writeup):
 *
 * - Three statuses are read as ROUTINE (no action needed right now) and get
 *   a plain tonal `surface-container` background, per the design system's
 *   "no border, tonal fill" chip convention: `Watching` (the default,
 *   lowest-weight state), `In Entry Zone` and `Holding` (informational, one
 *   tier brighter since they reflect an active/relevant state rather than
 *   passive tracking).
 * - Three statuses are read as URGENT (something changed, go look) and get
 *   a saturated-color-tinted background per the brief's explicit mapping:
 *   `Stop Hit` -> error (bad news), `Trim Hit` -> primary (good news — the
 *   brand green doubles as "take profit"), `Reassess Due` -> secondary. The
 *   tint follows the same "10% opacity of the saturated color, full-strength
 *   text in that color" treatment already used by the shadcn `Badge`
 *   `destructive` variant (`components/ui/badge.tsx`) and the add-ticker
 *   form's error banner, rather than inventing a new convention.
 * - `Reassess Due` additionally uses the `pulse-breathe` keyframe
 *   (`app/globals.css`) on its background layer — that keyframe and the
 *   secondary-container/secondary color pairing were explicitly reserved in
 *   Task 1 for "the Pulse chip" (`styles/tokens.css`'s comment on
 *   `--color-secondary-container`), and a time-based nudge ("go re-look at
 *   this") is the one status here that's about drawing the eye over time
 *   rather than a one-time state, matching what pulsing communicates.
 */
const STATUS_CONFIG: Record<
  StockStatus,
  { className: string; pulse?: boolean }
> = {
  Watching: { className: "bg-surface-container-high text-on-surface/70" },
  "In Entry Zone": {
    className: "bg-surface-container-highest text-on-surface",
  },
  Holding: { className: "bg-surface-container-highest text-on-surface" },
  "Stop Hit": { className: "bg-error/10 text-error" },
  "Trim Hit": { className: "bg-primary/10 text-primary" },
  "Reassess Due": {
    className: "bg-secondary-container text-secondary",
    pulse: true,
  },
};

/** Normalizes case/spacing/punctuation variants of a raw status string. */
function normalizeStatus(raw: string): StockStatus {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");

  switch (key) {
    case "watching":
      return "Watching";
    case "inentryzone":
      return "In Entry Zone";
    case "holding":
      return "Holding";
    case "stophit":
      return "Stop Hit";
    case "trimhit":
      return "Trim Hit";
    case "reassessdue":
      return "Reassess Due";
    default:
      // Safe default for the current DB default ("watching" already matches
      // above, but this also covers anything genuinely unrecognized) rather
      // than throwing or rendering a raw/garbled string.
      return "Watching";
  }
}

export function StatusChip({ status }: { status: string }) {
  const resolved = normalizeStatus(status);
  const config = STATUS_CONFIG[resolved];

  return (
    <span
      className={cn(
        // No-Line Rule: no border — a tonal/tinted background is the only
        // boundary cue, matching the chip conventions used elsewhere
        // (`components/ui/badge.tsx`).
        "relative inline-flex h-5 w-fit shrink-0 items-center overflow-hidden rounded-full px-2 text-xs font-medium whitespace-nowrap",
        config.className,
      )}
    >
      {config.pulse ? (
        <span
          aria-hidden
          className="absolute inset-0 animate-[pulse-breathe_2.4s_ease-in-out_infinite] bg-secondary"
        />
      ) : null}
      <span className="relative">{resolved}</span>
    </span>
  );
}
