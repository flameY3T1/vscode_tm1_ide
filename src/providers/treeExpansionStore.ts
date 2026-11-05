/**
 * Persists the set of expanded TreeView node IDs across VS Code reloads.
 *
 * Stable per-workspace via `vscode.Memento` (workspaceState). Hot path is
 * `isExpanded(id)` — called once per node in `Tm1TreeDataProvider.getChildren`.
 *
 * Writes are debounced (PERSIST_DEBOUNCE_MS) to coalesce rapid expand/collapse
 * sequences (e.g. when the user holds down arrow keys).
 *
 * Memento is abstracted as a minimal interface so tests can pass a plain map.
 */

const STORAGE_KEY = 'tm1.tree.expandedIds';
export const PERSIST_DEBOUNCE_MS = 500;

/** Minimal subset of vscode.Memento we depend on (keeps test mocks tiny). */
export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export class TreeExpansionStore {
  private _ids: Set<string>;
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  constructor(private readonly _memento: Memento) {
    const stored = this._memento.get<string[]>(STORAGE_KEY);
    this._ids = new Set<string>(Array.isArray(stored) ? stored : []);
  }

  isExpanded(id: string): boolean {
    return this._ids.has(id);
  }

  setExpanded(id: string): void {
    if (this._disposed) { return; }
    if (this._ids.has(id)) { return; }
    this._ids.add(id);
    this._schedulePersist();
  }

  setCollapsed(id: string): void {
    if (this._disposed) { return; }
    if (!this._ids.delete(id)) { return; }
    this._schedulePersist();
  }

  /**
   * Forget all expansion state belonging to one server — the serverRoot node
   * (`serverRoot:<id>`) and every child id (prefix `<id>:`). Lets a reconnect
   * start fresh instead of restoring the previous expansion. Returns true if
   * anything was removed.
   */
  clearForServer(serverId: string): boolean {
    if (this._disposed) { return false; }
    const rootId = `serverRoot:${serverId}`;
    const childPrefix = `${serverId}:`;
    let changed = false;
    for (const id of this._ids) {
      if (id === rootId || id.startsWith(childPrefix)) {
        this._ids.delete(id);
        changed = true;
      }
    }
    if (changed) { this._schedulePersist(); }
    return changed;
  }

  /** For tests and debugging — number of currently-expanded ids. */
  size(): number {
    return this._ids.size;
  }

  /** Cancel pending persist + flush immediately. Idempotent. */
  async dispose(): Promise<void> {
    if (this._disposed) { return; }
    this._disposed = true;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
      await this._memento.update(STORAGE_KEY, [...this._ids]);
    }
  }

  /** For tests — force an immediate persist. */
  async flushForTest(): Promise<void> {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    await this._memento.update(STORAGE_KEY, [...this._ids]);
  }

  private _schedulePersist(): void {
    if (this._persistTimer) { clearTimeout(this._persistTimer); }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      void this._memento.update(STORAGE_KEY, [...this._ids]);
    }, PERSIST_DEBOUNCE_MS);
  }
}
