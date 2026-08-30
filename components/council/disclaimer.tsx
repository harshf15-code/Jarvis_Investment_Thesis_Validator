import { cn } from "@/lib/utils";
import { COUNCIL_DISCLAIMER } from "@/lib/jarvis-council";

/**
 * Required on every surface that renders a persona — the roster, the picker and
 * the report.
 *
 * The shipped built-ins carry the real names of living investors, which is what
 * makes this line load-bearing rather than decorative. It is therefore always
 * visible: no tooltip, no disclosure triangle, no "see details". One component
 * so the wording cannot drift between the three places it appears.
 */
export function CouncilDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-snug text-on-surface-variant/60", className)}>
      {COUNCIL_DISCLAIMER}
    </p>
  );
}
