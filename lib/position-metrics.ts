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
 * Distance from current price down to the stop, in the stock's own currency
 * and in percent. Used to drive HUB-2's default "nearest stop first" sort
 * (US-03) — a SMALLER `absolute`/`percent` (including negative, meaning
 * already through the stop) sorts first.
 *
 * `absolute`, not `rupees`: the field has held dollars for every US position
 * since the day this app got a second market, and a name that says otherwise
 * is the same class of mistake as `formatCurrency` deriving INR from an
 * exchange. Sorting on `percent` is what makes the sort currency-safe;
 * `absolute` is only ever rendered next to its own currency symbol.
 */
export function computeDistanceToStop(input: {
  currentPrice: number;
  stopLoss: number | null;
}): { absolute: number; percent: number } | null {
  if (input.stopLoss === null) return null;
  const absolute = input.currentPrice - input.stopLoss;
  const percent = (absolute / input.currentPrice) * 100;
  return { absolute, percent };
}

/** Default "danger zone" width for HUB-1's near-stop alert (spec US-01: within 3% of the stop). */
export const NEAR_STOP_PERCENT = 3;

/**
 * Whether a position is close enough to its stop to earn HUB-1's RED alert
 * pill (US-01). A position already trading *through* its stop is a superset
 * of "near" it, so a negative distance counts too — the Cockpit rail must not
 * go quiet on the one position that most needs an exit decision.
 *
 * Returns false when there is no stop or no quote to measure against; an
 * unmeasurable position is not an alert, it's a gap.
 */
export function isNearStop(input: {
  currentPrice: number | null | undefined;
  stopLoss: number | null | undefined;
  thresholdPercent?: number;
}): boolean {
  if (input.currentPrice == null || input.stopLoss == null) return false;
  const distance = computeDistanceToStop({
    currentPrice: input.currentPrice,
    stopLoss: input.stopLoss,
  });
  return distance !== null && distance.percent <= (input.thresholdPercent ?? NEAR_STOP_PERCENT);
}
