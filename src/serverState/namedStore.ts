/**
 * Shared blueprint for the three server stores.
 *
 * `tm1.servers`, `tm1.adminServers` and `tm1.credentials` are the same
 * thing: a list of entries with an `id` in `globalState`, plus the same four
 * operations every time — list, get one, create or update one, remove one.
 * The three modules used to spell this out three times, with three
 * different ideas of where the `ExtensionContext` comes from and who fires
 * `onServerChanged`. That's exactly what delete protection hinges on:
 * `credentialUsers` must know BOTH reference sources, and whoever adds a
 * fourth store should not reinvent this a fourth time.
 *
 * Deliberately NOT unified is who notifies (`notify`): the server store
 * deliberately does not fire `onServerChanged` itself, because its callers
 * rewrite whole lists and then report exactly once afterwards.
 *
 * Context and notification come in as callbacks rather than from
 * `state.ts` — otherwise a cycle would form (`state` → `namedStore` →
 * `state`), which `no-circular` breaks.
 */
import type * as vscode from 'vscode';

export interface NamedEntry { id: string }

/** The same four operations, either on `_ctx` or on a passed-in context.
 *  `replaceAll` is the bulk path (rewrite the whole list). */
export interface StoreOps<T extends NamedEntry> {
  list(): T[];
  get(id: string): T | undefined;
  upsert(entry: T): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(entries: T[]): Promise<void>;
}

export interface NamedStore<T extends NamedEntry> extends StoreOps<T> {
  /** For callers that pass their `ExtensionContext` through anyway (the
   *  server store does this at over 25 spots) — the same operations, just
   *  without the module context. */
  withCtx(ctx: vscode.ExtensionContext): StoreOps<T>;
  /** Collision-free id: `Date.now()` alone collides when several entries are
   *  created within the same tick — hence the counter appended to it. */
  newId(): string;
}

export function namedStore<T extends NamedEntry>(
  key: string,
  opts: {
    idPrefix: string;
    /** This store's module context — read only at call time, because the
     *  modules get imported before `initServerManager` has run. */
    ctx: () => vscode.ExtensionContext | undefined;
    /** Called after every write access, if set. */
    notify?: () => void;
    /**
     * Runs over EVERY entry, both on read and on write.
     *
     * The reason is process templates: their password must not end up in
     * `globalState`, nor from there in the webview or an export bundle.
     * Both ends need the same filter, and that's exactly why it belongs in
     * the blueprint rather than in the two call sites — otherwise you forget
     * it at one of the two ends.
     */
    sanitize?: (entry: T) => T;
  },
): NamedStore<T> {
  let seq = 0;

  function ops(ctx: vscode.ExtensionContext | undefined): StoreOps<T> {
    const sanitize = opts.sanitize ?? ((e: T) => e);
    const read = (): T[] => (ctx?.globalState.get<T[]>(key) ?? []).map(sanitize);
    async function write(list: T[]): Promise<void> {
      if (!ctx) { return; }
      await ctx.globalState.update(key, list);
      opts.notify?.();
    }
    return {
      list: read,
      get: (id) => read().find(e => e.id === id),
      upsert: async (entry) => {
        const clean = sanitize(entry);
        const list = read();
        const idx = list.findIndex(e => e.id === clean.id);
        const next = [...list];
        if (idx >= 0) { next[idx] = clean; } else { next.push(clean); }
        await write(next);
      },
      remove: async (id) => { await write(read().filter(e => e.id !== id)); },
      replaceAll: (list) => write(list.map(sanitize)),
    };
  }

  const dyn: StoreOps<T> = {
    list: () => ops(opts.ctx()).list(),
    get: (id) => ops(opts.ctx()).get(id),
    upsert: (e) => ops(opts.ctx()).upsert(e),
    remove: (id) => ops(opts.ctx()).remove(id),
    replaceAll: (l) => ops(opts.ctx()).replaceAll(l),
  };

  return {
    ...dyn,
    withCtx: (ctx) => ops(ctx),
    newId: () => `${opts.idPrefix}${Date.now().toString(36)}${(seq++).toString(36)}`,
  };
}
