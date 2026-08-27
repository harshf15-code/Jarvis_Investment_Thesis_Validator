import { cn } from "@/lib/utils";
import type { ConvictionTier } from "@/lib/types";

/** Tier I: gold/primary. Tier II: amber (dimmer primary). Tier III: blue. Tier IV: grey — per spec US-09. */
const TIER_STYLES: Record<ConvictionTier, string> = {
  I: "bg-primary text-on-primary",
  II: "bg-primary/25 text-primary",
  III: "bg-status-blue-container text-status-blue",
  IV: "bg-surface-container-highest text-on-surface/60",
};

export function ConvictionBadge({ tier }: { tier: ConvictionTier }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 font-display text-xs font-semibold tracking-wide",
        TIER_STYLES[tier],
      )}
    >
      TIER {tier}
    </span>
  );
}
