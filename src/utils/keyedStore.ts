/**
 * Shared blueprint of the stores that hold ONE `Record<key, T>` under
 * one `globalState` key.
 *
 * Second family next to `serverManager/namedStore.ts`: that one has lists of
 * entries with an `id`, this one has mappings "server (or server +
 * subject) → setting". Seven modules had spelled out the same three moves —
 * `readAll`, `load`, `save` —, `ruleFormatConfigStore.ts`
 * line for line like `formatConfigStore.ts`, only with a different key.
 *
 * The real gain is not the saved lines, though, but
 * `purgePrefix`: `deleteServer` used to clean up two of nine stores, the
 * other seven kept the entries of deleted servers unreachable in
 * `globalState`. Whoever adds the eighth store should not invent the cleanup
 * by hand an eighth time — they register their key in
 * `serverState/stateKeys.ts` and are done.
 *
 * LEAF without imports, also without `vscode` types — for the same reason as
 * `workbench/workbenchPurge.ts` and `dimension/attrColumnStore.ts`:
 * `deleteServer` has to call the cleanup, and an import from a module
 * with dependencies closes a cycle back to `serverManager`.
 */

/** Only the part of `ExtensionContext` that these stores touch. */
export interface KeyedMemento {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

/** The moves on a fixed context. */
export interface KeyedOps<TStored, TLoaded> {
  /** The raw mapping. For callers that go over all entries. */
  all(): Record<string, TStored>;
  /** Always a usable value — `normalize` fills in what is missing. */
  load(key: string): TLoaded;
  save(key: string, value: TStored): Promise<void>;
  /** Removes exactly one entry. If it is missing, nothing is written at all. */
  remove(key: string): Promise<void>;
  /**
   * Drops all entries whose key starts with `prefix`.
   *
   * Composite keys (server + dimension) can thus be cleared just like simple
   * ones — the caller decides whether to pass in the whole
   * key or only its server part.
   *
   * @returns Number of removed entries; 0 writes nothing at all.
   */
  purgePrefix(prefix: string): Promise<number>;
}

export interface KeyedStore<TStored, TLoaded> extends KeyedOps<TStored, TLoaded> {
  /** For callers that pass their context through anyway (the purge path
   *  of `deleteServer` and the MDX history do) — the same moves,
   *  just without the module context. */
  withCtx(ctx: KeyedMemento): KeyedOps<TStored, TLoaded>;
}

export function keyedStore<TStored, TLoaded = TStored>(
  storageKey: string,
  opts: {
    /** Module context of this store — read only at call time, because the
     *  modules are imported before activation has run. */
    ctx: () => KeyedMemento | undefined;
    /** Turns what is stored into a usable value and supplies the
     *  default for `undefined`. Also catches structurally broken
     *  entries (`globalState` written by someone else). */
    normalize: (stored: TStored | undefined) => TLoaded;
    /** True ⇒ `save` DELETES the entry instead of storing an empty
     *  value. Without it the store grows with empty entries. */
    isEmpty?: (value: TStored) => boolean;
  },
): KeyedStore<TStored, TLoaded> {
  function ops(ctx: KeyedMemento | undefined): KeyedOps<TStored, TLoaded> {
    const read = (): Record<string, TStored> => {
      const raw = ctx?.globalState.get<unknown>(storageKey);
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, TStored>
        : {};
    };
    async function write(map: Record<string, TStored>): Promise<void> {
      if (!ctx) { return; }
      await ctx.globalState.update(storageKey, map);
    }
    return {
      all: read,
      load: (key) => opts.normalize(read()[key]),
      save: async (key, value) => {
        const map = { ...read() };
        if (opts.isEmpty?.(value)) { delete map[key]; } else { map[key] = value; }
        await write(map);
      },
      remove: async (key) => {
        const map = read();
        if (!(key in map)) { return; }
        const next = { ...map };
        delete next[key];
        await write(next);
      },
      purgePrefix: async (prefix) => {
        const map = read();
        const kept: Record<string, TStored> = {};
        let removed = 0;
        for (const [k, v] of Object.entries(map)) {
          if (k.startsWith(prefix)) { removed++; } else { kept[k] = v; }
        }
        if (removed === 0) { return 0; }
        await write(kept);
        return removed;
      },
    };
  }

  return {
    all: () => ops(opts.ctx()).all(),
    load: (k) => ops(opts.ctx()).load(k),
    save: (k, v) => ops(opts.ctx()).save(k, v),
    remove: (k) => ops(opts.ctx()).remove(k),
    purgePrefix: (p) => ops(opts.ctx()).purgePrefix(p),
    withCtx: (ctx) => ops(ctx),
  };
}
