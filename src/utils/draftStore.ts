/**
 * Generic close-/crash-recovery store for webview editors.
 *
 * A `WebviewPanel` close cannot be intercepted — `onDidDispose` fires after the
 * panel is already gone, so no "save your changes?" prompt can block it. Editors
 * therefore keep the host's copy of their content current and park it here when
 * a dirty panel disappears; the next open offers it back.
 *
 * `vscode`-free on purpose: the store takes a `DraftMemento`, which
 * `vscode.Memento` satisfies structurally, so the eviction and corruption
 * handling are unit-tested against a plain object.
 */

/** The slice of `vscode.Memento` a draft store needs. */
export interface DraftMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/**
 * Max parked drafts per store. Drafts are user content, so evicting is a last
 * resort — but an unbounded map in globalState would grow forever across every
 * object on every server the user ever touched.
 */
export const MAX_DRAFTS = 50;

interface Entry<T> { savedAt: number; draft: T }

export interface DraftStore<T> {
  /** Parks `draft` under `itemKey`, evicting the oldest entries past the cap. */
  save(memento: DraftMemento, itemKey: string, draft: T, now: number): Promise<void>;
  /** The parked draft, or undefined if there is none (or it is unusable). */
  load(memento: DraftMemento, itemKey: string): (T & { savedAt: number }) | undefined;
  /** True if a usable draft is parked. Cheaper than loading it. */
  has(memento: DraftMemento, itemKey: string): boolean;
  /** Removes the parked draft — call after a successful save or a discard. */
  clear(memento: DraftMemento, itemKey: string): Promise<void>;
}

/**
 * Builds a draft store rooted at `storeKey` in a Memento.
 *
 * `isUsable` rejects entries whose payload cannot be restored — a shape change
 * or a hand-edited store must degrade to "no draft", never to a throw on open.
 */
export function createDraftStore<T extends object>(
  storeKey: string,
  isUsable: (draft: unknown) => boolean,
  maxDrafts: number = MAX_DRAFTS,
): DraftStore<T> {
  function readAll(memento: DraftMemento): Record<string, Entry<T>> {
    const raw = memento.get<unknown>(storeKey, {});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return {}; }
    return raw as Record<string, Entry<T>>;
  }

  function usable(entry: unknown): entry is Entry<T> {
    if (!entry || typeof entry !== 'object') { return false; }
    const draft = (entry as Entry<T>).draft;
    return !!draft && typeof draft === 'object' && isUsable(draft);
  }

  return {
    async save(memento, itemKey, draft, now) {
      const all = { ...readAll(memento), [itemKey]: { savedAt: now, draft } };
      const keys = Object.keys(all);
      if (keys.length > maxDrafts) {
        const byAge = keys.sort((a, b) => (all[a]?.savedAt ?? 0) - (all[b]?.savedAt ?? 0));
        for (const stale of byAge.slice(0, keys.length - maxDrafts)) { delete all[stale]; }
      }
      await memento.update(storeKey, all);
    },

    load(memento, itemKey) {
      const entry = readAll(memento)[itemKey];
      if (!usable(entry)) { return undefined; }
      return { ...entry.draft, savedAt: entry.savedAt };
    },

    has(memento, itemKey) {
      return usable(readAll(memento)[itemKey]);
    },

    async clear(memento, itemKey) {
      const all = readAll(memento);
      if (!(itemKey in all)) { return; }
      delete all[itemKey];
      await memento.update(storeKey, all);
    },
  };
}
