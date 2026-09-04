import { cn } from "@/lib/utils";
import type { Portfolio } from "@/lib/types";

/**
 * Shown wherever Jarvis has given a verdict on a MANAGED book.
 *
 * Not a second copy of the Council disclaimer, which is about the personas
 * being simulations. This says something narrower and more actionable: the
 * panel was briefed that this money is not the trader's, so the advice on
 * screen was written to a different standard — and the trader should not read
 * it as they would a read on their own book.
 *
 * Rendered rather than assumed, because ownership changes three things and this
 * is the only one of them the trader could otherwise miss: the badge is easy to
 * overlook and the exclusion from the aggregate is visible only as a number
 * that looks low.
 */
export function FiduciaryNote({
  portfolio,
  className,
}: {
  portfolio: Pick<Portfolio, "ownership" | "beneficiary_name"> | null;
  className?: string;
}) {
  if (portfolio?.ownership !== "managed") return null;
  const who = portfolio.beneficiary_name?.trim();
  return (
    <p
      className={cn(
        "rounded-lg bg-status-amber-container px-4 py-3 text-[11px] leading-snug text-status-amber",
        className,
      )}
    >
      This is money you manage {who ? `for ${who}` : "for someone else"}. Jarvis was told so, and
      judged the book to that standard rather than to your own appetite. It is still decision
      support and still not investment advice — and here the consequences of acting on it fall on
      someone who is not in the room.
    </p>
  );
}
