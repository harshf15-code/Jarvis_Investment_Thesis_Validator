import { formatCurrency } from "@/lib/format";

/** Renders a price, or the spec's "Price unavailable" amber badge when null. */
export function PriceBadge({
  price,
  currency,
}: {
  price: number | null;
  currency: string;
}) {
  if (price === null) {
    return (
      <span className="rounded-full bg-primary-container px-2 py-0.5 text-xs font-medium text-primary">
        Price unavailable
      </span>
    );
  }
  return <span className="font-mono tabular-nums">{formatCurrency(price, currency)}</span>;
}
