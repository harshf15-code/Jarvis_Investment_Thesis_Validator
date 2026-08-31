/**
 * Shared bounded-parallelism helper.
 *
 * Lifted out of `app/api/prices/refresh/route.ts`, where it was written to
 * keep an on-demand price refresh from stampeding Yahoo. The CSV import needs
 * exactly the same bound for exactly the same reason, and two copies of a
 * concurrency limiter is one copy too many.
 */

/** Runs `worker` over `items`, at most `limit` at a time. */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await worker(next);
    }
  });
  await Promise.all(runners);
}

/** Yahoo is an unofficial endpoint with no published quota; do not stampede it. */
export const MAX_CONCURRENT_QUOTES = 8;
