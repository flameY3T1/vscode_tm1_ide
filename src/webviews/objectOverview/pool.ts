/**
 * mapPool(items, limit, fn) — bounded-concurrency async array mapper.
 * Preserves order. Never exceeds `limit` parallel executions.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  let index = 0;
  // Guard against limit <= 0: still need at least one worker to make progress
  // (otherwise zero workers spawn and `results` stays full of `undefined` holes).
  const concurrency = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  };

  // Each worker promise is the one `Promise.all` awaits directly — no derived
  // `.finally()` promise is created, so a rejection can't slip past as a
  // stray unhandledRejection independent of this `Promise.all`.
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}
