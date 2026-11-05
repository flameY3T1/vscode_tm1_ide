import { describe, it, expect, beforeEach } from 'vitest';
import {
  withRequestSlot,
  setRequestGateLimit,
  _gateActiveForTest,
  _resetRequestGateForTest,
} from '../../../tm1Rest/transport/requestGate';

/** Request that only completes on demand. */
function deferred(): { promise: Promise<string>; done: (v?: string) => void; fail: (e: Error) => void } {
  let done!: (v?: string) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    done = (v = 'ok') => res(v);
    fail = rej;
  });
  return { promise, done, fail };
}

describe('requestGate — Parallelitaetsbremse pro Server', () => {
  beforeEach(() => { _resetRequestGateForTest(4); });

  it('lets requests through concurrently up to the cap', async () => {
    setRequestGateLimit(2);
    const a = deferred(); const b = deferred();
    let started = 0;
    void withRequestSlot('h', () => { started++; return a.promise; });
    void withRequestSlot('h', () => { started++; return b.promise; });
    await Promise.resolve();
    expect(started).toBe(2);
    expect(_gateActiveForTest('h')).toBe(2);
    a.done(); b.done();
  });

  it('holds back the third request until a slot becomes free', async () => {
    setRequestGateLimit(2);
    const a = deferred(); const b = deferred(); const c = deferred();
    let thirdStarted = false;
    void withRequestSlot('h', () => a.promise);
    void withRequestSlot('h', () => b.promise);
    const third = withRequestSlot('h', () => { thirdStarted = true; return c.promise; });
    await Promise.resolve();
    expect(thirdStarted).toBe(false);

    a.done();
    await a.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(thirdStarted).toBe(true);

    c.done(); b.done();
    await expect(third).resolves.toBe('ok');
  });

  it('frees the slot in the error case too', async () => {
    setRequestGateLimit(1);
    const a = deferred();
    const first = withRequestSlot('h', () => a.promise);
    let secondStarted = false;
    const second = withRequestSlot('h', () => { secondStarted = true; return Promise.resolve('zweite'); });

    a.fail(new Error('kaputt'));
    await expect(first).rejects.toThrow('kaputt');
    await expect(second).resolves.toBe('zweite');
    expect(secondStarted).toBe(true);
    expect(_gateActiveForTest('h')).toBe(0);
  });

  it('frees the slot on a synchronous throw too', async () => {
    setRequestGateLimit(1);
    const first = withRequestSlot('h', () => { throw new Error('sofort'); });
    await expect(first).rejects.toThrow('sofort');
    expect(_gateActiveForTest('h')).toBe(0);
    await expect(withRequestSlot('h', () => Promise.resolve('danach'))).resolves.toBe('danach');
  });

  it('deckelt je Server getrennt', async () => {
    setRequestGateLimit(1);
    const a = deferred(); const b = deferred();
    let bStarted = false;
    void withRequestSlot('server-a:1', () => a.promise);
    void withRequestSlot('server-b:2', () => { bStarted = true; return b.promise; });
    await Promise.resolve();
    // A full cap on server A must not slow down server B.
    expect(bStarted).toBe(true);
    a.done(); b.done();
  });

  it('lets waiting requests move up immediately when the cap is raised', async () => {
    setRequestGateLimit(1);
    const a = deferred(); const b = deferred();
    let bStarted = false;
    void withRequestSlot('h', () => a.promise);
    void withRequestSlot('h', () => { bStarted = true; return b.promise; });
    await Promise.resolve();
    expect(bStarted).toBe(false);

    setRequestGateLimit(2);
    await Promise.resolve();
    expect(bStarted).toBe(true);
    a.done(); b.done();
  });
});
