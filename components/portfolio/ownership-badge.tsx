import { cn } from "@/lib/utils";
import type { Portfolio } from "@/lib/types";

/**
 * Says whose money a book is, wherever the book is named.
 *
 * A managed book is capital held for someone else, and the badge is the cheapest
 * of the three things that distinguishes one — the other two being the framing
 * Jarvis is given and its exclusion from the aggregate total. It is here so that
 * the exclusion never has to be inferred from a number that looks low.
 */
export function OwnershipBadge({
  portfolio,
  className,
}: {
  portfolio: Pick<Portfolio, "ownership" | "beneficiary_name">;
  className?: string;
}) {
  if (portfolio.ownership !== "managed") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-status-amber-container px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-status-amber",
        className,
      )}
      title={
        portfolio.beneficiary_name
          ? `Held on behalf of ${portfolio.beneficiary_name}. Not counted in your own totals.`
          : "Held on behalf of someone else. Not counted in your own totals."
      }
    >
      {portfolio.beneficiary_name ? `For ${portfolio.beneficiary_name}` : "Managed"}
    </span>
  );
}
