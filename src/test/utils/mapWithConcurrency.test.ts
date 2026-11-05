import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';

const tick = (ms = 5) => new Promise<void>(r => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('maps every item and preserves input order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => { await tick(); return n * 10; });
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('never runs more than `limit` tasks concurrently', async () => {
    let active = 0, max = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      active++; max = Math.max(max, active);
      await tick();
      active--;
    });
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(1); // actually parallel, not serial
  });

  it('returns [] for an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('passes the index to the callback', async () => {
    const out = await mapWithConcurrency(['a', 'b'], 2, async (v, i) => `${v}${i}`);
    expect(out).toEqual(['a0', 'b1']);
  });
});
