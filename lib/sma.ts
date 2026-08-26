/**
 * Simple moving average over a series of closing prices.
 */

/**
 * Returns an array the same length as `closes`, where each index holds the
 * rolling average of the trailing `window` values ending at that index, or
 * `null` for the leading indices where a full window isn't yet available
 * (i.e. indices `0` through `window - 2`).
 */
export function simpleMovingAverage(
  closes: number[],
  window: number,
): (number | null)[] {
  if (window <= 0) {
    throw new RangeError(`window must be a positive integer, got ${window}`);
  }

  const result: (number | null)[] = new Array(closes.length).fill(null);

  let windowSum = 0;
  for (let i = 0; i < closes.length; i++) {
    windowSum += closes[i];

    if (i >= window) {
      windowSum -= closes[i - window];
    }

    if (i >= window - 1) {
      result[i] = windowSum / window;
    }
  }

  return result;
}
