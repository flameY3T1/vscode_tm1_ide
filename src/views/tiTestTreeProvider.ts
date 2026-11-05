/**
 * VS Code TreeDataProvider that surfaces the discovered TI tests as a
 * sidebar tree. Folder nodes mirror the on-disk layout under
 * `tm1.tests.rootFolder`. Test leaves carry a transient run-status (pass /
 * fail / not-run / disabled / running) so the icon column reflects the
 * outcome of the most recent simulate run. Status data lives in memory only;
 * lookup key is the absolute folder path so it survives refresh.
 *
 * The provider is intentionally watcher-agnostic — `extension.ts` wires a
 * `vscode.workspace.createFileSystemWatcher('**\/manifest.json')` and calls
 * `refresh()` on change. Keeping the watcher external keeps this class
 * testable without a FSWatcher mock.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  discoverTests,
  buildTreeFromDiscovery,
  collectTests,
  type TreeNode,
  type TestEntry,
} from '../tiTestFramework/discovery/testDiscovery';
import {
  readRunState,
  writeRunState,
  recordRun,
  RUN_STATE_FILENAME,
  type RunState,
} from '../tiTestFramework/storage/runStateIo';
import { readManifest, isRootManifest } from '../tiTestFramework/storage/manifestIo';
import { logBestEffort } from '../providers/bestEffortLog';

const SUBS_DIR = 'subs';

export type TestRunStatus = 'pass' | 'fail' | 'notRun' | 'disabled' | 'running';

const STATUS_ICONS: Record<TestRunStatus, { id: string; color?: string }> = {
  pass: { id: 'pass', color: 'testing.iconPassed' },
  fail: { id: 'error', color: 'testing.iconFailed' },
  notRun: { id: 'circle-outline' },
  disabled: { id: 'circle-slash' },
  running: { id: 'sync' },
};

export type ItemExtras = {
  /** For folder nodes: descendant test counts (active + total). */
  counts?: { active: number; total: number };
  /** For test nodes: last-run timestamp (ms). */
  lastRunAt?: number;
  /** For test nodes: last successful run timestamp (ms). */
  lastSuccessAt?: number;
};

export function formatGermanDateTime(input: string | number | undefined): string | undefined {
  if (input === undefined || input === null) return undefined;
  const d = new Date(input);
  if (isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHM(input: number | undefined): string | undefined {
  if (input === undefined) return undefined;
  const d = new Date(input);
  if (isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class TiTestTreeItem extends vscode.TreeItem {
  constructor(
    public readonly node: TreeNode,
    public readonly status: TestRunStatus,
    public readonly extras: ItemExtras = {},
  ) {
    const collapsible =
      node.kind === 'folder' ||
      (node.kind === 'test' && node.children.length > 0) ||
      (node.kind === 'sub' && node.children.length > 0)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    super(node.label, collapsible);

    this.id = node.fullPath;
    this.description = buildDescription(node, status, extras);
    this.tooltip = buildTooltip(node, status, extras);
    this.contextValue = buildContextValue(node, status);
    this.iconPath = buildIcon(node, status);

    if (node.kind === 'test' || node.kind === 'sub') {
      this.command = {
        command: 'tm1.tiTest.showLastDiff',
        title: 'Show Last Diff',
        arguments: [node.fullPath],
      };
    } else if (node.kind === 'folder' && node.relativePath) {
      this.command = {
        command: 'tm1.tiTest.showFolderSummary',
        title: 'Show Folder Summary',
        arguments: [this],
      };
    }
  }
}

function buildDescription(
  node: TreeNode,
  status: TestRunStatus,
  extras: ItemExtras,
): string | undefined {
  if (node.kind === 'folder') {
    const c = extras.counts;
    if (!c || c.total === 0) return undefined;
    if (c.active === c.total) {
      return c.total === 1 ? '1 Test' : `${c.total} Tests`;
    }
    return `${c.active}/${c.total} Tests`;
  }
  const statusText = (() => {
    switch (status) {
      case 'pass': return 'pass';
      case 'fail': return 'fail';
      case 'running': return 'running…';
      case 'disabled': return 'disabled';
      default: return '';
    }
  })();
  const time = formatHM(extras.lastRunAt);
  if (statusText && time) return `${statusText} · ${time}`;
  if (statusText) return statusText;
  return undefined;
}

function buildTooltip(node: TreeNode, status: TestRunStatus, extras: ItemExtras): string {
  if (node.kind === 'folder') {
    const lines: string[] = [node.relativePath || '/'];
    if (extras.counts) lines.push(`Tests: ${extras.counts.active}/${extras.counts.total} aktiv`);
    return lines.join('\n');
  }
  const m = node.manifest;
  const capturedAt = m && 'captured' in m ? (m as { captured: { at: string } }).captured.at : undefined;
  const captured = capturedAt ? formatGermanDateTime(capturedAt) : undefined;
  const lastRun = formatGermanDateTime(extras.lastRunAt);
  const lastSuccess = formatGermanDateTime(extras.lastSuccessAt);
  // Only show "last success" when distinct from lastRun (avoid duplication).
  const showSuccess = lastSuccess && extras.lastSuccessAt !== extras.lastRunAt;
  const lines = [
    `${node.label}`,
    m && isRootManifest(m) ? vscode.l10n.t('Process: {0}', m.process) : '',
    captured ? vscode.l10n.t('Captured: {0}', captured) : '',
    lastRun ? vscode.l10n.t('Last run: {0}', lastRun) : '',
    showSuccess ? vscode.l10n.t('Last success: {0}', lastSuccess) : '',
    vscode.l10n.t('Status: {0}', status),
  ].filter(Boolean);
  return lines.join('\n');
}

function buildContextValue(node: TreeNode, status: TestRunStatus): string {
  if (node.kind === 'folder') return 'tiTestFolder';
  if (node.kind === 'sub') return status === 'disabled' ? 'tiTest.sub.disabled' : 'tiTest.sub';
  if (status === 'disabled') return 'tiTest.disabled';
  return 'tiTest.active';
}

function buildIcon(node: TreeNode, status: TestRunStatus): vscode.ThemeIcon {
  if (node.kind === 'folder') {
    const spec = STATUS_ICONS[status];
    if ((status === 'pass' || status === 'fail' || status === 'running') && spec.color) {
      return new vscode.ThemeIcon('folder', new vscode.ThemeColor(spec.color));
    }
    return new vscode.ThemeIcon('folder');
  }
  // Sub-tests use the same pass/fail icons as root tests so user
  // can scan results at a glance regardless of hierarchy.
  const spec = STATUS_ICONS[status];
  return spec.color
    ? new vscode.ThemeIcon(spec.id, new vscode.ThemeColor(spec.color))
    : new vscode.ThemeIcon(spec.id);
}

export class TiTestTreeProvider implements vscode.TreeDataProvider<TiTestTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TiTestTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _root: TreeNode | undefined;
  private readonly _runState = new Map<string, RunState>();
  private readonly _running = new Set<string>();

  constructor(private readonly _getRootFolder: () => string | undefined) {}

  async refresh(): Promise<void> {
    this._root = undefined;
    await this._loadRoot();
    this._onDidChangeTreeData.fire(undefined);
    void this._syncContext();
  }

  /** Mirrors `top-level children > 0` into `tm1.tiTests.hasItems` context-key. */
  private async _syncContext(): Promise<void> {
    const hasItems = !!this._root && this._root.children.length > 0;
    await vscode.commands.executeCommand('setContext', 'tm1.tiTests.hasItems', hasItems);
  }

  markRunning(folder: string): void {
    this._running.add(folder);
    this._onDidChangeTreeData.fire(undefined);
  }

  updateLastRun(folder: string, pass: boolean): void {
    const prev = this._runState.get(folder) ?? {};
    const next = recordRun(prev, pass);
    this._runState.set(folder, next);
    this._running.delete(folder);
    // Fire-and-forget persistence — UI shouldn't block on disk I/O.
    void writeRunState(folder, next).catch(e => logBestEffort('TiTest', `persist run-state for "${folder}"`, e));
    this._onDidChangeTreeData.fire(undefined);
  }

  clearLastRun(folder: string): void {
    this._runState.delete(folder);
    this._running.delete(folder);
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TiTestTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TiTestTreeItem): Promise<TiTestTreeItem[]> {
    if (!this._root) {
      await this._loadRoot();
      void this._syncContext();
    }
    if (!this._root) return [];

    const node = element ? element.node : this._root;
    return node.children.map((c) => new TiTestTreeItem(c, this._statusFor(c), this._extrasFor(c)));
  }

  private _extrasFor(node: TreeNode): ItemExtras {
    if (node.kind === 'folder') {
      let active = 0;
      let total = 0;
      const stack: TreeNode[] = [node];
      while (stack.length > 0) {
        const n = stack.pop()!;
        if (n.kind === 'test') {
          total++;
          if (!(n.manifest && n.manifest.active === false)) active++;
        } else {
          for (const c of n.children) stack.push(c);
        }
      }
      return { counts: { active, total } };
    }
    const state = this._runState.get(node.fullPath);
    if (!state) return {};
    return {
      lastRunAt: state.lastRun?.at,
      lastSuccessAt: state.lastSuccessAt,
    };
  }

  getRunState(folder: string): RunState | undefined {
    return this._runState.get(folder);
  }

  collectTestsBelow(item?: TiTestTreeItem): TestEntry[] {
    const node = item ? item.node : this._root;
    if (!node) return [];
    return collectTests(node);
  }

  findNode(folder: string): TreeNode | undefined {
    if (!this._root) return undefined;
    const stack: TreeNode[] = [this._root];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.fullPath === folder) return n;
      for (const c of n.children) stack.push(c);
    }
    return undefined;
  }

  /**
   * Find the TiTestTreeItem whose node.fullPath matches `folder`.
   * Only works after `_root` is populated (call `getChildren()` or `refresh()` first).
   */
  findItemByFolder(folder: string): TiTestTreeItem | undefined {
    if (!this._root) return undefined;
    const stack: TreeNode[] = [this._root];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.fullPath === folder) {
        return new TiTestTreeItem(n, this._statusFor(n), this._extrasFor(n));
      }
      for (const c of n.children) stack.push(c);
    }
    return undefined;
  }

  private _statusFor(node: TreeNode): TestRunStatus {
    if (node.kind === 'folder') return this._aggregateFolderStatus(node);
    if (this._running.has(node.fullPath)) return 'running';
    if (node.manifest && node.manifest.active === false) return 'disabled';
    const r = this._runState.get(node.fullPath)?.lastRun;
    // For root test nodes that have subs, bubble up the aggregated status so a
    // failing sub turns the parent row red even when the root itself passed.
    if (node.kind === 'test' && node.children.some((c) => c.kind === 'sub')) {
      const agg = this._aggStatus(node);
      if (agg === 'pass') return 'pass';
      if (agg === 'fail') return 'fail';
      // 'never-run' — fall through to show own run state
    }
    if (r?.result === 'pass') return 'pass';
    if (r?.result === 'fail') return 'fail';
    return 'notRun';
  }

  /**
   * Attach sub-nodes to the given test TreeNode. Sources, in priority order:
   *   1. On-disk subs/<name>/manifest.json (legacy + recursive subs)
   *   2. Root manifest.subs[] synthesised when no on-disk folder exists
   *      (Phase 2.5 UI: sub data lives flat in parent's data/ folder).
   */
  private async _attachSubs(node: TreeNode): Promise<void> {
    const subsDir = path.join(node.fullPath, SUBS_DIR);
    const seen = new Set<string>();
    let dirents: { name: string; isDirectory: () => boolean }[] = [];
    try {
      dirents = await fs.readdir(subsDir, { withFileTypes: true });
    } catch {
      /* no subs/ dir — proceed to synth from root manifest */
    }
    for (const e of dirents) {
      if (!e.isDirectory()) continue;
      const subFolder = path.join(subsDir, e.name);
      let manifest;
      try {
        manifest = await readManifest(subFolder);
      } catch {
        continue;
      }
      if (!('kind' in manifest) || manifest.kind !== 'ti-test-sub') continue;
      const subNode: TreeNode = {
        kind: 'sub',
        label: e.name,
        fullPath: subFolder,
        relativePath: `${node.relativePath}/${SUBS_DIR}/${e.name}`,
        children: [],
        manifest,
      };
      seen.add(e.name);
      await this._attachSubs(subNode);
      node.children.push(subNode);
    }

    if (node.kind === 'test' && node.manifest && isRootManifest(node.manifest)) {
      const declared = (node.manifest as { subs?: string[] }).subs ?? [];
      const rootName = (node.manifest as { name: string }).name;
      for (const name of declared) {
        if (seen.has(name)) continue;
        const subNode: TreeNode = {
          kind: 'sub',
          label: name,
          fullPath: path.join(subsDir, name),
          relativePath: `${node.relativePath}/${SUBS_DIR}/${name}`,
          children: [],
          manifest: {
            version: 2,
            kind: 'ti-test-sub',
            name,
            parent: '../..',
            rootTest: rootName,
            clonedFrom: name,
            parameters: [],
            callContext: { callerProcess: rootName, callerLine: 0, callIndex: 0 },
            active: true,
          },
        };
        node.children.push(subNode);
      }
    }

    node.children.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  }

  /**
   * Aggregate run-status for a folder based on its active test descendants.
   * - any descendant running → running
   * - any active test fail → fail
   * - all active tests pass (and >=1 active) → pass
   * - else (mix with notRun, or only disabled, or empty) → notRun
   */
  private _aggregateFolderStatus(node: TreeNode): TestRunStatus {
    let running = false;
    let anyFail = false;
    let allPass = true;
    let activeCount = 0;
    const stack: TreeNode[] = [node];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.kind === 'test') {
        if (n.manifest && n.manifest.active === false) continue;
        activeCount++;
        if (this._running.has(n.fullPath)) {
          running = true;
          allPass = false;
          continue;
        }
        const r = this._runState.get(n.fullPath)?.lastRun;
        if (r?.result === 'fail') { anyFail = true; allPass = false; }
        else if (r?.result !== 'pass') { allPass = false; }
      } else {
        for (const c of n.children) stack.push(c);
      }
    }
    if (running) return 'running';
    if (anyFail) return 'fail';
    if (activeCount > 0 && allPass) return 'pass';
    return 'notRun';
  }

  private async _loadRoot(): Promise<void> {
    const root = this._getRootFolder();
    if (!root) {
      this._root = undefined;
      return;
    }
    const result = await discoverTests(root);
    this._root = buildTreeFromDiscovery(root, result.entries, result.emptyFolders);
    // Attach sub-folder children to every test node (parallel).
    await Promise.all(result.entries.map((e) => {
      const node = this._findNodeInTree(this._root!, e.folder);
      return node ? this._attachSubs(node) : Promise.resolve();
    }));
    // Hydrate persisted run-state for every discovered test (parallel reads).
    await Promise.all(
      result.entries.map(async (e) => {
        if (this._runState.has(e.folder)) return; // session-overrides win
        const state = await readRunState(e.folder);
        if (state.lastRun || state.lastSuccessAt !== undefined) {
          this._runState.set(e.folder, state);
        }
      }),
    );
  }

  /**
   * Returns the aggregated last-run status for a test folder:
   *   'pass'      iff own .last-run.json result === 'pass' AND every sub (recursively) has result === 'pass'
   *   'fail'      if own or any sub has result === 'fail'
   *   'never-run' if own has no .last-run.json yet (or result is unrecognised)
   */
  aggregatedStatus(testFolder: string): 'pass' | 'fail' | 'never-run' {
    const node = this.findNode(testFolder);
    if (!node) return 'never-run';
    return this._aggStatus(node);
  }

  private _aggStatus(node: TreeNode): 'pass' | 'fail' | 'never-run' {
    const own = this._getRunResult(node.fullPath);
    if (own === undefined) return 'never-run';
    if (own === 'fail') return 'fail';
    // own === 'pass' — check sub children recursively
    for (const child of node.children) {
      if (child.kind !== 'sub') continue;
      const childStatus = this._aggStatus(child);
      if (childStatus === 'fail') return 'fail';
      if (childStatus === 'never-run') return 'never-run';
    }
    return 'pass';
  }

  private _getRunResult(folder: string): 'pass' | 'fail' | undefined {
    // Prefer the in-memory cache (set by updateLastRun / hydrated on load).
    const cached = this._runState.get(folder)?.lastRun;
    if (cached) return cached.result;
    // Fall back to a synchronous disk read so aggregatedStatus stays sync.
    try {
      const raw = require('node:fs').readFileSync(
        path.join(folder, RUN_STATE_FILENAME),
        'utf8',
      ) as string;
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (j.result === 'pass' || j.result === 'fail') return j.result;
      // Also handle the nested RunState shape: { lastRun: { result, at } }
      if (
        j.lastRun &&
        typeof j.lastRun === 'object' &&
        ((j.lastRun as Record<string, unknown>).result === 'pass' ||
          (j.lastRun as Record<string, unknown>).result === 'fail')
      ) {
        return (j.lastRun as Record<string, unknown>).result as 'pass' | 'fail';
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Walk the pre-built tree to find a node by absolute path. */
  private _findNodeInTree(root: TreeNode, folder: string): TreeNode | undefined {
    if (root.fullPath === folder) return root;
    for (const c of root.children) {
      const found = this._findNodeInTree(c, folder);
      if (found) return found;
    }
    return undefined;
  }
}

export function resolveRootFolder(): string | undefined {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return undefined;
  const setting = vscode.workspace
    .getConfiguration('tm1.tests')
    .get<string>('rootFolder', 'tm1tests');
  return path.isAbsolute(setting) ? setting : path.join(ws.uri.fsPath, setting);
}
