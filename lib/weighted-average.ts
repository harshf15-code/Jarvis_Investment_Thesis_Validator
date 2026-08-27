/**
 * Weighted-average entry price across all of a position's `entries` rows —
 * spec US-05's exact formula: `sum(qty × price) / sum(qty)`. Pure function,
 * shared by `POST /api/positions/[id]/entries` (Task 12) and every screen
 * that displays a position's blended average (Tasks 13, 21) so the math
 * never drifts between the write path and the read paths.
 */
export function computeWeightedAverageEntry(
  entries: { quantity: number; price: number }[],
): { totalQuantity: number; averagePrice: number } {
  const totalQuantity = entries.reduce((sum, e) => sum + e.quantity, 0);
  if (totalQuantity === 0) {
    return { totalQuantity: 0, averagePrice: 0 };
  }
  const totalCost = entries.reduce((sum, e) => sum + e.quantity * e.price, 0);
  return { totalQuantity, averagePrice: totalCost / totalQuantity };
}
