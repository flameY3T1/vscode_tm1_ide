/**
 * Last picks of the consolidation compare per server, dimension and hierarchy.
 * Same blueprint as `dimension/attrColumnStore.ts`: `keyedStore` with the
 * server part from `stateKeys`, so deleting a profile cleans it up.
 */
import { keyedStore, type KeyedMemento } from '../../utils/keyedStore';
import { CC_VIEW_KEY, prefixFor } from '../../serverState/stateKeys';
import type { CompareView } from '../../consolidationCompare/protocol';

const key = (serverId: string, dim: string, hier: string): string =>
  prefixFor(serverId) + encodeURIComponent(`${dim}\u0000${hier}`);

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const store = keyedStore<CompareView>(CC_VIEW_KEY, {
  ctx: () => undefined,
  normalize: (e) => ({
    ref: str(e?.ref), cmp: strs(e?.cmp), alias: str(e?.alias),
    scopeAttr: str(e?.scopeAttr), scopeValue: str(e?.scopeValue),
    group: e?.group === true, onlyDiff: e?.onlyDiff !== false,
  }),
  isEmpty: (v) => !v.ref && !v.cmp.length && !v.alias && !v.scopeAttr && !v.group && v.onlyDiff,
});

export function loadView(ctx: KeyedMemento, serverId: string, dim: string, hier: string): CompareView {
  return store.withCtx(ctx).load(key(serverId, dim, hier));
}

export async function saveView(ctx: KeyedMemento, serverId: string, dim: string, hier: string, v: CompareView): Promise<void> {
  await store.withCtx(ctx).save(key(serverId, dim, hier), v);
}
