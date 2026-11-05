import { describe, it, expect } from 'vitest';
import { runSerializedRefresh, clearRefreshState } from '../../commands/cubeViewer/state';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('runSerializedRefresh', () => {
  it('runs tasks strictly one after the other per panel', async () => {
    const key = 'p1';
    const order: string[] = [];
    const gate = deferred();

    const a = runSerializedRefresh(key, async () => {
      order.push('a-start');
      await gate.promise;
      order.push('a-end');
    });
    // let a start, THEN enqueue b — b has to wait until a is done
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['a-start']);
    const b = runSerializedRefresh(key, async () => {
      order.push('b-start');
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['a-start']); // b is blocked as long as a is running

    gate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
    clearRefreshState(key);
  });

  it('latest-wins: on a synchronous burst only the last task runs', async () => {
    const key = 'p2';
    const ran: string[] = [];

    const a = runSerializedRefresh(key, async () => { ran.push('a'); });
    const b = runSerializedRefresh(key, async () => { ran.push('b'); });
    const c = runSerializedRefresh(key, async () => { ran.push('c'); });

    await Promise.all([a, b, c]);
    // a and b had already been overtaken by c at dequeue time → skipped
    expect(ran).toEqual(['c']);
    clearRefreshState(key);
  });

  it('latest-wins: requests enqueued while a task is running — only the most recent runs afterwards', async () => {
    const key = 'p2b';
    const ran: string[] = [];
    const gate = deferred();

    const a = runSerializedRefresh(key, async () => { ran.push('a'); await gate.promise; });
    await new Promise((r) => setTimeout(r, 5)); // a is running
    const b = runSerializedRefresh(key, async () => { ran.push('b'); });
    const c = runSerializedRefresh(key, async () => { ran.push('c'); });

    gate.resolve();
    await Promise.all([a, b, c]);
    expect(ran).toEqual(['a', 'c']); // b skipped, a was already in flight
    clearRefreshState(key);
  });

  it('an error in one task does not break the chain', async () => {
    const key = 'p3';
    const ran: string[] = [];

    await expect(runSerializedRefresh(key, async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    await runSerializedRefresh(key, async () => { ran.push('next'); });

    expect(ran).toEqual(['next']);
    clearRefreshState(key);
  });

  it('panels are independent of each other', async () => {
    const ran: string[] = [];
    const gate = deferred();

    const a = runSerializedRefresh('pA', async () => { await gate.promise; ran.push('A'); });
    const b = runSerializedRefresh('pB', async () => { ran.push('B'); });

    await b;
    expect(ran).toEqual(['B']); // B not blocked by A
    gate.resolve();
    await a;
    clearRefreshState('pA');
    clearRefreshState('pB');
  });
});
