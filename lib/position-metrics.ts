/** Unrealized P&L for a position's remaining quantity vs its weighted-average entry. */
export function computePositionPnl(input: {
  currentPrice: number;
  avgEntry: number;
  quantity: number;
}): { absolute: number; percent: number } {
  const absolute = (input.currentPrice - input.avgEntry) * input.quantity;
  const percent = ((input.currentPrice - input.avgEntry) / input.avgEntry) * 100;
  return { absolute, percent };
}

/**
 * Rupee/percent distance from current price down to the stop. Used to
 * drive HUB-2's default "nearest stop first" sort (US-03) — a SMALLER
 * `rupees`/`percent` (including negative, meaning already through the
 * stop) sorts first.
 */
export function computeDistanceToStop(input: {
  currentPrice: number;
  stopLoss: number | null;
}): { rupees: number; percent: number } | null {
  if (input.stopLoss === null) return null;
  const rupees = input.currentPrice - input.stopLoss;
  const percent = (rupees / input.currentPrice) * 100;
  return { rupees, percent };
}
