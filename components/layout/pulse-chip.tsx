import { cn } from "@/lib/utils";

/**
 * The design system's "Pulse" chip (DESIGN.md section 5, Trading-Specific
 * Components): "For active trades, use a `secondary_container` chip with a
 * `secondary` text. Add a 'breathing' animation to the background opacity
 * (from 10% to 30%)."
 *
 * Deferred from Task 1 (which only defined the `pulse-breathe` keyframe in
 * `app/globals.css`) and Task 6 (which shipped `StockCard` without it) —
 * this is where it lands: applied to Holding-type stock cards on the
 * dashboard (`components/dashboard/stock-card.tsx`) to mark "you have an
 * open position here," distinct from `StatusChip`'s six lifecycle states
 * (which apply to watchlist and holding entries alike).
 *
 * Layered the same way `status-chip.tsx`'s own "Reassess Due" pulse layer
 * is: a static `secondary-container` tonal chip with an absolutely
 * positioned, `aria-hidden` `secondary`-colored layer breathing on top via
 * `pulse-breathe`, so the label text stays fully legible instead of
 * breathing along with the background.
 */
export function PulseChip({
  label = "Active Position",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // No-Line Rule: a tonal/tinted background is the boundary, no border.
        "relative inline-flex h-5 w-fit shrink-0 items-center overflow-hidden rounded-full bg-secondary-container px-2 text-xs font-medium text-secondary",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 animate-[pulse-breathe_2.4s_ease-in-out_infinite] bg-secondary"
      />
      <span className="relative">{label}</span>
    </span>
  );
}
