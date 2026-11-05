/**
 * Concurrency-bounded `Promise.all`.
 *
 * An unbounded `Promise.all([...].map(fetch))` over a server-derived list turns a
 * single user action into as many simultaneous requests as the server happens to
 * report objects — the rules linter fanned out one full `Elements` load per cube
 * dimension that way, from a Diagnostics run nobody asked for.
 *
 * vscode-free by design so it stays usable from the pure/`tm1Rest` layers.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) { return results; }

  // A limit of 0 or less would park every worker forever; serialise instead.
  const width = Math.min(Math.max(1, Math.floor(limit)), items.length);
  let next = 0;

  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) { return; }
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
