import { describe, it, expect } from 'vitest';
import { mapPool } from '../../../webviews/objectOverview/pool';

describe('mapPool', () => {
  it('preserves order and never exceeds the limit', async () => {
    let active = 0, maxActive = 0;
    const fn = async (n: number) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 5));
      active--; return n * 2;
    };
    const out = await mapPool([1, 2, 3, 4, 5], 2, fn);
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
  it('handles empty input', async () => {
    expect(await mapPool([], 4, async (x) => x)).toEqual([]);
  });
  it('clamps limit<=0 to at least one worker (no undefined holes)', async () => {
    const out = await mapPool([1, 2, 3], 0, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6]);
  });
  it('clamps a negative limit to at least one worker', async () => {
    const out = await mapPool(['a', 'b'], -3, async (s) => s.toUpperCase());
    expect(out).toEqual(['A', 'B']);
  });
});
