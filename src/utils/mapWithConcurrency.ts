/**
 * Map `items` through `fn` with at most `limit` concurrent in-flight calls.
 * Results are returned in input order. A worker-pool bounds the fan-out so a
 * large input (e.g. all cubes × all MDX views) cannot burst thousands of
 * simultaneous requests through a shared keep-alive agent.
 *
 * `fn` is expected to handle its own errors (e.g. return a sentinel) if
 * per-item isolation is required — a throw from `fn` rejects the whole batch.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
