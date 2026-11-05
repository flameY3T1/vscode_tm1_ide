import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveWithin } from '../../utils/resolveWithin';

afterEach(() => vi.useRealTimers());

describe('resolveWithin', () => {
  it('resolves as soon as the promise settles, before the timeout', async () => {
    const result = await resolveWithin(Promise.resolve('x'), 100_000).then(() => 'done');
    expect(result).toBe('done');
  });

  it('resolves after the timeout when the promise never settles', async () => {
    vi.useFakeTimers();
    let settled = false;
    const p = resolveWithin(new Promise<void>(() => { /* never */ }), 3000).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(settled).toBe(true);
  });

  it('never rejects even when the promise rejects', async () => {
    await expect(resolveWithin(Promise.reject(new Error('boom')), 1000)).resolves.toBeUndefined();
  });
});
