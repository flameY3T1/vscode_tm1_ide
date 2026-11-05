import * as vscode from 'vscode';
import { iconPath } from './providers/tm1TreeNodes';
import { listRuns, onDidChangeRuns, type RunEntry } from './runState/runRegistry';
import { formatElapsed } from './runState/runningTreeProvider';
import { RECENT_ITEMS_KEY } from './serverState/stateKeys';
import { onServerChanged } from './serverState/state';

/**
 * Recently opened TM1 editor target.
 *
 * Persisted in globalState; max MAX_ITEMS entries are kept.
 * Identity = `${kind}|${serverId}|${name}` (case-sensitive). Re-opening
 * the same target moves it to the top instead of duplicating.
 */
export interface RecentItem {
  kind: 'process' | 'rule' | 'threads';
  /** Server identity (serverUrl or composite id) — must match `getServerConfig` lookup. */
  serverId: string;
  /** Optional server display name for the tree label. */
  serverName?: string;
  /** Process name OR cube name (for rule). */
  name: string;
  /** Wall-clock open time (ms epoch). Used for ordering only. */
  ts: number;
  /**
   * Pinned (favorite): stays on top, does not count against MAX_ITEMS and stays
   * when the list is cleared. Opening again does not move it —
   * favorites that swap places on every click cannot be found blindly.
   */
  pinned?: boolean;
}

const STATE_KEY = RECENT_ITEMS_KEY;
/**
 * How many entries the list holds.
 *
 * Raised from 5 to 15 (instruction from flameY3T1, 2026-08-26). 5 was chosen for the view
 * when it was nothing but a short list; anyone working on several
 * processes at once pushed the older ones out themselves. The cap stays because the view
 * would otherwise push the Explorer below it away — running executions are listed
 * at the top of the same view.
 */
const MAX_ITEMS = 15;

function itemKey(it: { kind: string; serverId: string; name: string }): string {
  return `${it.kind}|${it.serverId}|${it.name}`;
}

/**
 * What this view shows: the executions running right now, then the recently
 * opened targets. Running entries are NOT persisted — they live in the run
 * registry and vanish with the extension host.
 */
export type RecentNode = RunEntry | RecentItem | RecentGroup;

/**
 * Heading "Favorites" or "Recently opened".
 *
 * Pinned is recognizable by the group the entry is in — not by
 * a marker in the row. The pin as a decoration stayed after
 * unpinning until you clicked elsewhere. Groups exist only as long as
 * there are favorites; otherwise the list stays flat.
 */
export interface RecentGroup { group: 'pinned' | 'recent' }
const PINNED_GROUP: RecentGroup = { group: 'pinned' };
const RECENT_GROUP: RecentGroup = { group: 'recent' };

function isGroup(node: RecentNode): node is RecentGroup {
  return (node as RecentGroup).group !== undefined;
}

function isRun(node: RecentNode): node is RunEntry {
  return (node as RunEntry).startedAt !== undefined;
}

/**
 * An entry as the Explorer's process and rule commands expect it.
 *
 * The Explorer commands ("Run", "Delete", "Deploy", "Copy name", …) read
 * `nodeType` and `meta.{processName|cubeName,serverId}` from a `Tm1TreeNode`.
 * Instead of registering twin commands for the "Recent" list, the entry gets
 * the same fields along — the commands then run unchanged. The fields are NOT
 * stored along: they only arise in `getChildren`, `globalState` keeps holding
 * the plain `RecentItem`.
 */
export type RecentProcessNode = RecentItem & {
  nodeType: 'process';
  meta: { processName: string; serverId: string };
};

export type RecentRuleNode = RecentItem & {
  nodeType: 'cubeRule';
  meta: { cubeName: string; serverId: string };
};

function asTreeNode(it: RecentItem): RecentItem {
  if (it.kind === 'process') {
    const node: RecentProcessNode = {
      ...it,
      nodeType: 'process',
      meta: { processName: it.name, serverId: it.serverId },
    };
    return node;
  }
  if (it.kind === 'rule') {
    const node: RecentRuleNode = {
      ...it,
      nodeType: 'cubeRule',
      meta: { cubeName: it.name, serverId: it.serverId },
    };
    return node;
  }
  return it;
}

export class RecentTreeProvider implements vscode.TreeDataProvider<RecentNode>, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<RecentNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private readonly _subs: vscode.Disposable[] = [];
  private _ticker: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Running executions share this view instead of getting one of their own:
    // a second view would push "Recent" down the sidebar, and the point of
    // putting runs here is that they sit at the top where they get seen.
    this._subs.push(onDidChangeRuns(() => this.refresh()));
    // `deleteServer` purges this store behind our back (`purgeServerState`)
    // and fires `onServerChanged` afterwards; redraw so the entries go too.
    this._subs.push(onServerChanged.event(() => this.refresh()));
    // Initial sync of `tm1.recent.hasItems` context-key — drives the
    // view's `when` clause (hide when empty).
    void this._syncContext();
  }

  dispose(): void {
    if (this._ticker !== undefined) { clearInterval(this._ticker); }
    this._subs.forEach(d => d.dispose());
    this._onDidChange.dispose();
  }

  /** Ticks the elapsed time, and only while something is actually running. */
  private _syncTicker(): void {
    const active = listRuns().length > 0;
    if (active && this._ticker === undefined) {
      this._ticker = setInterval(() => this._onDidChange.fire(undefined), 1000);
    } else if (!active && this._ticker !== undefined) {
      clearInterval(this._ticker);
      this._ticker = undefined;
    }
  }

  /** Returns the persisted items: pinned first (in pin order), then the rest newest first. */
  getItems(): RecentItem[] {
    const raw = this.context.globalState.get<RecentItem[]>(STATE_KEY, []);
    const all = Array.isArray(raw) ? raw.filter(this._isValid) : [];
    return [...all.filter(x => x.pinned), ...all.filter(x => !x.pinned)];
  }

  private async _save(items: RecentItem[]): Promise<void> {
    const pinned = items.filter(x => x.pinned);
    const rest = items.filter(x => !x.pinned).slice(0, MAX_ITEMS);
    await this.context.globalState.update(STATE_KEY, [...pinned, ...rest]);
    this._onDidChange.fire(undefined);
    void this._syncContext();
  }

  /** Records an open. Dedups by (kind, serverId, name) and trims the unpinned part to MAX_ITEMS. */
  async addRecent(it: Omit<RecentItem, 'ts' | 'pinned'>): Promise<void> {
    if (!it.name) { return; }
    const fresh: RecentItem = { ...it, ts: Date.now() };
    const key = itemKey(fresh);
    const items = this.getItems();
    const pinnedAt = items.findIndex(x => x.pinned && itemKey(x) === key);
    if (pinnedAt >= 0) {
      items[pinnedAt] = { ...fresh, pinned: true };
      await this._save(items);
      return;
    }
    await this._save([fresh, ...items.filter(x => itemKey(x) !== key)]);
  }

  /** Anheften / Loesen. */
  async setPinned(it: { kind: string; serverId: string; name: string }, pinned: boolean): Promise<void> {
    const key = itemKey(it);
    const items = this.getItems();
    const hit = items.find(x => itemKey(x) === key);
    if (!hit) { return; }
    const rest = items.filter(x => itemKey(x) !== key);
    const moved: RecentItem = { ...hit, pinned: pinned || undefined };
    // Between the favorites and the rest: pinned goes to the end of the favorites,
    // unpinned to the top of the remaining list.
    await this._save([...rest.filter(x => x.pinned), moved, ...rest.filter(x => !x.pinned)]);
  }

  /**
   * Removes EXACTLY one entry (the `x` on the row).
   *
   * Comparison is via `itemKey`, not object equality: the value
   * VS Code hands to the command is the node from `getChildren`, and it
   * does not survive a reload of the view in between.
   */
  async remove(it: { kind: string; serverId: string; name: string }): Promise<void> {
    const key = itemKey(it);
    await this._save(this.getItems().filter(x => itemKey(x) !== key));
  }

  /** Clears the list — favorites stay, only their own `x` removes them. */
  async clear(): Promise<void> {
    await this._save(this.getItems().filter(x => x.pinned));
  }

  refresh(): void {
    this._onDidChange.fire(undefined);
    void this._syncContext();
    this._syncTicker();
  }

  /**
   * Mirrors "there is anything to show" into the `tm1.recent.hasItems`
   * context-key. A running execution counts: on a fresh install with no
   * history the view would otherwise stay hidden while a process runs.
   */
  private async _syncContext(): Promise<void> {
    const hasItems = this.getItems().length > 0 || listRuns().length > 0;
    await vscode.commands.executeCommand('setContext', 'tm1.recent.hasItems', hasItems);
  }

  getTreeItem(element: RecentNode): vscode.TreeItem {
    if (isRun(element)) { return this._runTreeItem(element); }
    if (isGroup(element)) {
      const pinned = element.group === 'pinned';
      const ti = new vscode.TreeItem(
        pinned ? vscode.l10n.t('Favorites') : vscode.l10n.t('Recently opened'),
        vscode.TreeItemCollapsibleState.Expanded,
      );
      ti.id = `recent-group:${element.group}`;
      ti.iconPath = new vscode.ThemeIcon(pinned ? 'pinned' : 'history');
      return ti;
    }
    const ti = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    const kindLabel = element.kind === 'rule' ? 'Rule' : element.kind === 'threads' ? 'Threads' : 'Process';
    const where = element.serverName
      ? (element.kind === 'threads' ? element.serverName : `${kindLabel} · ${element.serverName}`)
      : element.kind;
    ti.description = where;
    const tipKind = element.kind === 'rule'
      ? vscode.l10n.t('Rule for cube')
      : element.kind === 'threads'
        ? vscode.l10n.t('Thread monitor')
        : vscode.l10n.t('Process');
    ti.tooltip = `${tipKind}: ${element.name}\nServer: ${element.serverName ?? element.serverId}`;
    // Same SVGs as the TM1 explorer tree (process → process.svg, rule → cube-rule.svg, threads → thread.svg).
    const iconName = element.kind === 'rule' ? 'cube-rule' : element.kind === 'threads' ? 'thread' : 'process';
    ti.iconPath = iconPath(this.context.extensionUri, iconName);
    // `.pinned` is appended at the END: the menus query `^recent\.process` and
    // thus apply to favorites as well as to normal entries.
    ti.contextValue = `recent.${element.kind}${element.pinned ? '.pinned' : ''}`;
    ti.command = {
      command: 'tm1.recent.open',
      title: 'Open',
      arguments: [element],
    };
    return ti;
  }

  /** A currently running execution. No `command` — clicking must not open anything. */
  private _runTreeItem(run: RunEntry): vscode.TreeItem {
    const ti = new vscode.TreeItem(run.objectName, vscode.TreeItemCollapsibleState.None);
    const elapsed = formatElapsed(Date.now() - run.startedAt);
    ti.description = run.cancelling ? vscode.l10n.t('cancelling… {0}', elapsed) : elapsed;
    ti.iconPath = new vscode.ThemeIcon(run.cancelling ? 'stop-circle' : 'loading~spin');
    const kind = run.kind === 'Chores' ? vscode.l10n.t('Chore') : vscode.l10n.t('Process');
    ti.tooltip = run.serverUrl
      ? `${kind}: ${run.objectName}\n${vscode.l10n.t('Server')}: ${run.serverUrl}`
      : `${kind}: ${run.objectName}`;
    // Drives the inline stop button; a run already cancelling gets no second one.
    ti.contextValue = run.cancelling ? 'tm1.run.cancelling' : 'tm1.run';
    ti.id = run.id;
    return ti;
  }

  getChildren(element?: RecentNode): RecentNode[] {
    const items = this.getItems();
    if (element) {
      if (!isGroup(element)) { return []; }
      const pinned = element.group === 'pinned';
      return items.filter(x => !!x.pinned === pinned).map(asTreeNode);
    }
    // Runs first — the reason they are in this view at all is to be on top.
    if (!items.some(x => x.pinned)) {
      return [...listRuns(), ...items.map(asTreeNode)];
    }
    const groups = items.some(x => !x.pinned) ? [PINNED_GROUP, RECENT_GROUP] : [PINNED_GROUP];
    return [...listRuns(), ...groups];
  }

  /** `TreeView.reveal` refuses to work without this. */
  getParent(element: RecentNode): RecentNode | undefined {
    if (isRun(element) || isGroup(element)) { return undefined; }
    if (!this.getItems().some(x => x.pinned)) { return undefined; }
    return element.pinned ? PINNED_GROUP : RECENT_GROUP;
  }

  private _isValid(x: unknown): x is RecentItem {
    if (typeof x !== 'object' || x === null) { return false; }
    const o = x as Record<string, unknown>;
    return (
      (o.kind === 'process' || o.kind === 'rule' || o.kind === 'threads') &&
      typeof o.serverId === 'string' &&
      typeof o.name === 'string' &&
      typeof o.ts === 'number' &&
      (o.pinned === undefined || typeof o.pinned === 'boolean')
    );
  }
}
