/**
 * Which attribute columns a dimension shows on a server.
 *
 * Built on the `utils/keyedStore` blueprint — server AND dimension are both
 * part of the key; cleanup on profile deletion has gone through
 * `serverManager/purgeServerState.ts` generically via `SERVER_STATE_KEYS`
 * since 2026-08-29. Both imported modules are LEAVES with no imports of
 * their own, otherwise a cycle would close back to `serverManager` here
 * (measured: 43 `no-circular` violations from a single line).
 */
import { keyedStore, type KeyedMemento } from '../../utils/keyedStore';
import { ATTRCOL_STATE_KEY, prefixFor } from '../../serverState/stateKeys';

export { ATTRCOL_STATE_KEY };

export interface AttrColumnState {
  cols: string[];
  widths: Record<string, number>;
}

/** Only the part of `ExtensionContext` this module touches. */
export type AttrColumnMemento = KeyedMemento;

/**
 * Server AND dimension in the key.
 *
 * `encodeURIComponent` BEFORE concatenating: a plain `serverId + '::' +
 * dim` does not distinguish `'s::a'+'b'` from `'s'+'a::b'` — both yield
 * `'s::a::b'`. `encodeURIComponent` encodes every colon INSIDE a part
 * as `%3A`, so a raw `::` in the result can only come from our own
 * separator. The prefix half comes from `stateKeys`, so that writing and
 * cleanup use the same form.
 */
function storageKey(serverId: string, dim: string): string {
  return prefixFor(serverId) + encodeURIComponent(dim);
}

/** An empty value DELETES the entry — otherwise storage grows with empty values. */
const store = keyedStore<AttrColumnState>(ATTRCOL_STATE_KEY, {
  // This store always gets its context from the caller (`withCtx`);
  // it has never had a module-level context.
  ctx: () => undefined,
  normalize: (e) => ({
    cols: Array.isArray(e?.cols) ? e!.cols.filter((c) => typeof c === 'string') : [],
    widths: e?.widths && typeof e.widths === 'object' ? e.widths : {},
  }),
  isEmpty: (v) => v.cols.length === 0,
});

export function loadAttrColumns(
  ctx: AttrColumnMemento, serverId: string, dim: string,
): AttrColumnState {
  return store.withCtx(ctx).load(storageKey(serverId, dim));
}

export async function saveAttrColumns(
  ctx: AttrColumnMemento, serverId: string, dim: string,
  cols: readonly string[], widths: Record<string, number>,
): Promise<void> {
  await store.withCtx(ctx).save(storageKey(serverId, dim), { cols: cols.slice(), widths });
}

/**
 * Discard the entries of a deleted server profile.
 *
 * Stays around as a named path (tests and the Dimension Browser call it),
 * the blueprint does the work. `deleteServer` itself has gone through
 * `purgeServerState` since 2026-08-29 and no longer falls in here.
 *
 * @returns Number of entries removed; 0 does not write at all.
 */
export async function purgeAttrColumnsForServer(
  ctx: AttrColumnMemento, serverId: string,
): Promise<number> {
  return store.withCtx(ctx).purgePrefix(prefixFor(serverId));
}
