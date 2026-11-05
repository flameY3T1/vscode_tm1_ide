// src/test/commands/namedStore.test.ts
//
// Guard for the shared blueprint of the three server stores. The four
// operations used to be written out three times; now they exist once,
// so this also needs the cases in which the three versions used to
// differ: who notifies, where the context comes from, and whether
// `upsert` creates or replaces.
import { describe, it, expect, vi } from 'vitest';
import { namedStore } from '../../serverState/namedStore';
import { fakeContext } from './fakeCtx';

interface Eintrag { id: string; name: string }

describe('namedStore', () => {
  it('creates, replaces by id and removes', async () => {
    const ctx = fakeContext();
    const store = namedStore<Eintrag>('test.key', { idPrefix: 't', ctx: () => ctx });

    expect(store.list()).toEqual([]);
    await store.upsert({ id: 'a', name: 'erst' });
    await store.upsert({ id: 'b', name: 'zweit' });
    expect(store.list()).toEqual([{ id: 'a', name: 'erst' }, { id: 'b', name: 'zweit' }]);

    // Same id = replace, NOT append — and the order stays.
    await store.upsert({ id: 'a', name: 'neu' });
    expect(store.list()).toEqual([{ id: 'a', name: 'neu' }, { id: 'b', name: 'zweit' }]);
    expect(store.get('a')).toEqual({ id: 'a', name: 'neu' });
    expect(store.get('gibtsnicht')).toBeUndefined();

    await store.remove('a');
    expect(store.list()).toEqual([{ id: 'b', name: 'zweit' }]);
    // An id that does not exist is not an error.
    await store.remove('gibtsnicht');
    expect(store.list()).toHaveLength(1);
  });

  it('reports every write when a callback is set — and none otherwise', async () => {
    const ctx = fakeContext();
    const notify = vi.fn();
    const laut = namedStore<Eintrag>('laut.key', { idPrefix: 'l', ctx: () => ctx, notify });
    await laut.upsert({ id: 'a', name: 'x' });
    await laut.remove('a');
    await laut.replaceAll([]);
    expect(notify).toHaveBeenCalledTimes(3);

    // The server store deliberately does not report by itself — its callers
    // rewrite whole lists and report exactly once afterwards.
    const still = namedStore<Eintrag>('still.key', { idPrefix: 's', ctx: () => ctx });
    await still.upsert({ id: 'a', name: 'x' });
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('without context: empty list, and a write attempt does not throw', async () => {
    const store = namedStore<Eintrag>('ohne.key', { idPrefix: 'o', ctx: () => undefined });
    expect(store.list()).toEqual([]);
    await expect(store.upsert({ id: 'a', name: 'x' })).resolves.toBeUndefined();
  });

  it('withCtx writes into the given context, not into the module context', async () => {
    const modul = fakeContext();
    const fremd = fakeContext();
    const store = namedStore<Eintrag>('beide.key', { idPrefix: 'b', ctx: () => modul });

    await store.withCtx(fremd).upsert({ id: 'a', name: 'x' });
    expect(store.withCtx(fremd).list()).toHaveLength(1);
    expect(store.list()).toEqual([]);
  });

  it('newId carries the prefix and does not collide within one tick', () => {
    const store = namedStore<Eintrag>('id.key', { idPrefix: 'adm', ctx: () => undefined });
    const ids = [store.newId(), store.newId(), store.newId()];
    expect(ids.every(i => i.startsWith('adm'))).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
});
