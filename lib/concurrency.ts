/**
 * Shared bounded-parallelism helper.
 *
 * Lifted out of `app/api/prices/refresh/route.ts`, where it was written to
 * keep an on-demand price refresh from stampeding Yahoo. The CSV import needs
 * exactly the same bound for exactly the same reason, and two copies of a
 * concurrency limiter is one copy too many.
 */

/**
 * Runs `worker` over `items`, at most `limit` at a time, and returns what each
 * one produced IN INPUT ORDER.
 *
 * Order matters because callers zip the results back against the input — a
 * result array in completion order would pair each holding with a different
 * holding's data. Callers whose worker returns nothing simply ignore the
 * array, which is why this stayed `Promise<void>` until something needed the
 * values back.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Yahoo is an unofficial endpoint with no published quota; do not stampede it. */
export const MAX_CONCURRENT_QUOTES = 8;
