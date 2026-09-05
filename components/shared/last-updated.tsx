import { formatExchangeTime } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/**
 * Spec Section 5 (Price Data): "Last updated: [timestamp]" on every screen
 * showing prices.
 *
 * `label` exists because one stamp can no longer speak for a whole screen.
 * Coins are polled hourly, seven days a week; equities are not polled at all
 * outside a session. A single "freshest price" stamp would therefore be a
 * coin's on almost every screen that holds one, and would quietly present a
 * Friday-evening equity price as minutes old all weekend.
 */
export function LastUpdated({
  at,
  exchange,
  label = "Last updated",
}: {
  at: string | null;
  exchange: ExchangeCode;
  label?: string;
}) {
  if (!at) return null;
  return (
    <span className="text-xs text-on-surface/40">
      {label}: {formatExchangeTime(new Date(at), exchange)}
    </span>
  );
}
