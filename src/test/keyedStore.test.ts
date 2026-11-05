import { describe, it, expect } from 'vitest';
import { keyedStore, type KeyedMemento } from '../utils/keyedStore';

function fakeCtx(seed: Record<string, unknown> = {}): KeyedMemento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    store,
    globalState: {
      get: <T>(k: string) => store.get(k) as T | undefined,
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
  };
}

describe('keyedStore', () => {
  it('normalizes missing values to the default', () => {
    const ctx = fakeCtx();
    const s = keyedStore<string[]>('k', { ctx: () => ctx, normalize: v => v ?? [] });
    expect(s.load('server-a')).toEqual([]);
  });

  it('writes and reads separately per key', async () => {
    const ctx = fakeCtx();
    const s = keyedStore<string[]>('k', { ctx: () => ctx, normalize: v => v ?? [] });
    await s.save('a', ['x']);
    await s.save('b', ['y']);
    expect(s.load('a')).toEqual(['x']);
    expect(s.load('b')).toEqual(['y']);
    expect(ctx.store.get('k')).toEqual({ a: ['x'], b: ['y'] });
  });

  it('catches a structurally broken store instead of throwing', () => {
    // An array or a scalar under the key: written by someone else or left over
    // from an older format. Previously `read()[key]` would have thrown.
    for (const roh of [[1, 2], 'text', 42, null]) {
      const ctx = fakeCtx({ k: roh });
      const s = keyedStore<string[]>('k', { ctx: () => ctx, normalize: v => v ?? [] });
      expect(s.load('a')).toEqual([]);
    }
  });

  it('deletes instead of storing empty values when isEmpty applies', async () => {
    const ctx = fakeCtx();
    const s = keyedStore<string[]>('k', {
      ctx: () => ctx, normalize: v => v ?? [], isEmpty: v => v.length === 0,
    });
    await s.save('a', ['x']);
    await s.save('a', []);
    expect(ctx.store.get('k')).toEqual({});
  });

  it('remove does not write at all when the entry is missing', async () => {
    const ctx = fakeCtx({ k: { a: ['x'] } });
    let schreibt = 0;
    ctx.globalState.update = async (kk: string, v: unknown) => { schreibt++; ctx.store.set(kk, v); };
    const s = keyedStore<string[]>('k', { ctx: () => ctx, normalize: v => v ?? [] });
    await s.remove('fehlt');
    expect(schreibt).toBe(0);
    await s.remove('a');
    expect(schreibt).toBe(1);
    expect(ctx.store.get('k')).toEqual({});
  });

  it('purgePrefix only hits the prefix and reports the count', async () => {
    const ctx = fakeCtx({ k: { 'sA::d1': 1, 'sA::d2': 2, 'sB::d1': 3 } });
    const s = keyedStore<number>('k', { ctx: () => ctx, normalize: v => v ?? 0 });
    expect(await s.purgePrefix('sA::')).toBe(2);
    expect(ctx.store.get('k')).toEqual({ 'sB::d1': 3 });
    expect(await s.purgePrefix('sA::')).toBe(0);
  });

  it('stays silent without a context instead of throwing', async () => {
    const s = keyedStore<string[]>('k', { ctx: () => undefined, normalize: v => v ?? [] });
    expect(s.load('a')).toEqual([]);
    await expect(s.save('a', ['x'])).resolves.toBeUndefined();
  });

  it('withCtx works on the passed context, not on the module context', async () => {
    const modul = fakeCtx();
    const fremd = fakeCtx();
    const s = keyedStore<number>('k', { ctx: () => modul, normalize: v => v ?? 0 });
    await s.withCtx(fremd).save('a', 7);
    expect(fremd.store.get('k')).toEqual({ a: 7 });
    expect(modul.store.has('k')).toBe(false);
  });
});
