import { describe, it, expect } from 'vitest';
import { mapLimit } from '../utils/mapLimit';

/** Resolves after `ms` — deliberately real timers, the peak counter needs overlap. */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('mapLimit', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapLimit(items, 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight--;
      return n;
    });

    expect(peak).toBe(3);
  });

  it('returns results in input order, not completion order', async () => {
    const items = [30, 5, 20, 1];
    const out = await mapLimit(items, 4, async (ms) => {
      await delay(ms);
      return ms;
    });
    expect(out).toEqual([30, 5, 20, 1]);
  });

  it('runs every item even when the limit is smaller than the list', async () => {
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); return n; });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects when a task rejects', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) { throw new Error('boom'); }
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('treats a limit below 1 as 1 instead of stalling', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapLimit([1, 2, 3], 0, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await delay(1);
      inFlight--;
      return n;
    });
    expect(peak).toBe(1);
  });

  it('handles an empty list without calling the worker', async () => {
    let calls = 0;
    const out = await mapLimit([], 4, async (n: number) => { calls++; return n; });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });
});
