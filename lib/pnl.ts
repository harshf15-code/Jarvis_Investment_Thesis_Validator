/**
 * Unrealized profit/loss math for a holding, comparing the latest quoted
 * price against the position's cost basis.
 *
 * Pulled out of `components/dashboard/stock-card.tsx` as a pure function per
 * Task 6's brief ("do not leave non-trivial math inline in a component if
 * it's easy to pull out and test") — see `lib/__tests__/pnl.test.ts`.
 */

export type UnrealizedPnl = {
  /** `(lastPrice - costBasis) * shares` — the absolute currency gain/loss. */
  absolute: number;
  /**
   * `(lastPrice - costBasis) / costBasis * 100` — percent return per share.
   * `null` when `costBasis` is `0`: a percent return against zero cost is
   * undefined (not `0%` and not `Infinity%`), so callers should render a
   * placeholder (e.g. "—") rather than a number in that case.
   */
  percent: number | null;
};

/**
 * `lastPrice`/`costBasis` are both per-share prices in the stock's native
 * currency; `shares` is the position size. Callers are responsible for only
 * calling this once `lastPrice` is known to be non-null (`Stock.last_price`
 * is nullable — a stock with no quote yet has no P&L to compute).
 */
export function computeUnrealizedPnl(
  lastPrice: number,
  shares: number,
  costBasis: number,
): UnrealizedPnl {
  const absolute = (lastPrice - costBasis) * shares;
  const percent =
    costBasis === 0 ? null : ((lastPrice - costBasis) / costBasis) * 100;

  return { absolute, percent };
}
