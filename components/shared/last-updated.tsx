import { formatExchangeTime } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/** Spec Section 5 (Price Data): "Last updated: [timestamp]" on every screen showing prices. */
export function LastUpdated({ at, exchange }: { at: string | null; exchange: ExchangeCode }) {
  if (!at) return null;
  return (
    <span className="text-xs text-on-surface/40">
      Last updated: {formatExchangeTime(new Date(at), exchange)}
    </span>
  );
}
