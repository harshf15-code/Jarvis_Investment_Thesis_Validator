import { formatCurrency } from "@/lib/format";
import type { ExchangeCode } from "@/lib/types";

/** Renders a price, or the spec's "Price unavailable" amber badge when null. */
export function PriceBadge({
  price,
  exchange,
}: {
  price: number | null;
  exchange: ExchangeCode;
}) {
  if (price === null) {
    return (
      <span className="rounded-full bg-primary-container px-2 py-0.5 text-xs font-medium text-primary">
        Price unavailable
      </span>
    );
  }
  return <span className="font-mono tabular-nums">{formatCurrency(price, exchange)}</span>;
}
