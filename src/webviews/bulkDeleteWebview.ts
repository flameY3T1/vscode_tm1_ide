// src/webviews/bulkDeleteWebview.ts
// Bulk delete: choose object kinds, filter by name pattern, see what
// hangs on them, and delete in ONE run.
//
// Why a page of its own and not just multi-select in the tree: clicking through 200 nodes with
// the Ctrl key held down is not a bulk delete. And the tree
// does not show what hangs on an object — TM1 never says so on its own.
//
// Views and subsets cost ONE call each for the whole server, not
// one per parent object (measured 2026-09-18: 146 views in 34 KB / 24 ms,
// 463 subsets in 124 KB / 6 ms).
//
// What the page does NOT cover: PRIVATE views and subsets. They live under
// `PrivateViews`/`PrivateSubsets` and belong to the respective user; deleting them along
// in a bulk form would hit someone else's work. In the tree they are
// reachable individually and with multi-select.
import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { escapeHtml } from '../utils/escapeHtml';
import { BULK_TABLE_CSS } from './bulkTableCss';
import { errMsg } from '../utils/errMsg';
import { buildBulkDeleteL10n } from './bulkDeleteL10n';
import { sortForDelete } from './bulkDeletePure';
import { rowLabel } from './bulkObjectsPure';
import { handleBulkSearch } from './bulkSearch';
import { OBJ_KINDS, type ObjKind } from '../utils/objectKinds';
import { objectRow } from '../tm1Rest/objectListingApi';
import type { L10nMap } from '../webviewClient/_shared/l10n';
import type {
  BulkRow, DeleteItem, DeleteOutcome, HostToWebview, WebviewToHost,
} from '../webviewClient/bulkDelete/protocol';

import { invalidateReferenceIndex } from '../references/referenceIndexService';
import { loadUsage, deleteOne } from '../commands/bulk/bulkDeleteOps';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { invalidateCache } from '../providers/fetchNames';
import { postTo } from './typedPost';


function body(l10n: L10nMap, serverLabel: string): string {
  // WITHOUT `checked`: nothing is loaded before someone has chosen a kind.
  const kindCheck = (k: ObjKind, labelKey: string): string =>
    `<label class="bd-check"><input type="checkbox" class="bd-kind-box" data-kind="${k}">`
    + `<span>${escapeHtml(l10n[labelKey] ?? k)}</span></label>`;
  return [
    '<div class="bd-head">',
    `  <span class="bd-title">${escapeHtml(l10n.title ?? 'Bulk Delete')}</span>`,
    `  <span class="bd-server">${escapeHtml(serverLabel)}</span>`,
    '  <span class="bd-spacer"></span>',
    '</div>',
    `<div class="bd-hint">${escapeHtml(l10n.hint ?? '')}</div>`,
    '<div class="bd-controls">',
    // Step 1: what is being searched for.
    `  <div class="bd-row bd-step"><span class="bd-step-num">1</span>${escapeHtml(l10n.step1 ?? '')}</div>`,
    '  <div class="bd-row">',
    `    <span class="bd-label">${escapeHtml(l10n.types ?? '')}</span>`,
    '    <span class="bd-kinds">',
    kindCheck('cube', 'kindCubes'),
    kindCheck('dimension', 'kindDimensions'),
    kindCheck('process', 'kindProcesses'),
    kindCheck('chore', 'kindChores'),
    kindCheck('view', 'kindViews'),
    kindCheck('subset', 'kindSubsets'),
    '    </span>',
    '  </div>',
    '  <div class="bd-row">',
    `    <span class="bd-label">${escapeHtml(l10n.pattern ?? '')}</span>`,
    `    <input type="text" id="bd-pattern" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(l10n.patternPlaceholder ?? '')}">`,
    `    <label class="bd-check"><input type="checkbox" id="bd-control"><span>${escapeHtml(l10n.showControl ?? '')}</span></label>`,
    '  </div>',
    `  <div class="bd-row"><span class="bd-label"></span><span class="bd-help">${escapeHtml(l10n.patternHelp ?? '')}</span></div>`,
    '  <div class="bd-row">',
    '    <span class="bd-label"></span>',
    `    <button id="bd-search" disabled>${escapeHtml(l10n.searchBtn ?? '')}</button>`,
    `    <span class="bd-help" id="bd-search-hint">${escapeHtml(l10n.pickTypes ?? '')}</span>`,
    '  </div>',
    '  <div class="bd-sep"></div>',
    // Step 2: select AND check — the same order as on the
    // migration page. The check takes exactly the ticked rows, so
    // the selection buttons belong before it and not with the delete.
    `  <div class="bd-row bd-step"><span class="bd-step-num">2</span>${escapeHtml(l10n.step2 ?? '')}</div>`,
    '  <div class="bd-row">',
    '    <span class="bd-label"></span>',
    `    <button class="secondary" id="bd-all">${escapeHtml(l10n.selectAll ?? '')}</button>`,
    `    <button class="secondary" id="bd-none">${escapeHtml(l10n.selectNone ?? '')}</button>`,
    `    <button class="secondary" id="bd-usage" disabled>${escapeHtml(l10n.usageBtn ?? '')}</button>`,
    '  </div>',
    '  <div class="bd-sep"></div>',
    // Step 3: the irreversible action, visibly separated from the two
    // before it.
    `  <div class="bd-row bd-step"><span class="bd-step-num">3</span>${escapeHtml(l10n.step3 ?? '')}</div>`,
    '  <div class="bd-row">',
    '    <span class="bd-label"></span>',
    `    <button class="danger" id="bd-delete" disabled>${escapeHtml(l10n.deleteBtn ?? '')}</button>`,
    '    <span class="bd-count" id="bd-count"></span>',
    '  </div>',
    '</div>',
    '<div class="bd-busy" id="bd-busy" hidden></div>',
    '<div class="bd-note" id="bd-note" hidden></div>',
    '<div class="bd-error" id="bd-error" hidden></div>',
    '<div class="bd-wrap">',
    '  <table class="bd-table">',
    '    <thead><tr>',
    '      <th style="width:26px"><input type="checkbox" id="bd-head-box"></th>',
    // The arrow stands BEFORE the row, not after the last number: what a
    // row expands belongs at its start.
    '      <th style="width:20px"></th>',
    `      <th style="width:90px">${escapeHtml(l10n.colType ?? '')}</th>`,
    `      <th>${escapeHtml(l10n.colName ?? '')}</th>`,
    // Numbers only line up if their columns have a fixed width — exactly
    // what makes two rows below each other comparable. The names are in
    // the detail row that the arrow expands.
    `      <th style="width:120px">${escapeHtml(l10n.colStatus ?? '')}</th>`,
    `      <th class="bd-num" style="width:70px">${escapeHtml(l10n.kindProcesses ?? '')}</th>`,
    `      <th class="bd-num" style="width:64px">${escapeHtml(l10n.colRules ?? '')}</th>`,
    `      <th class="bd-num" style="width:64px">${escapeHtml(l10n.kindChores ?? '')}</th>`,
    `      <th class="bd-num" style="width:64px">${escapeHtml(l10n.kindViews ?? '')}</th>`,
    `      <th class="bd-num" style="width:70px">${escapeHtml(l10n.kindSubsets ?? '')}</th>`,
    '    </tr></thead>',
    '    <tbody id="bd-tbody"></tbody>',
    '  </table>',
    '  <div class="bd-empty" id="bd-empty" hidden></div>',
    '</div>',
  ].join('\n');
}

/** Row of the table, from the shared enumeration. */
function row(kind: ObjKind, name: string, parent?: string, hierarchy?: string): BulkRow {
  return objectRow(kind, name, parent, hierarchy) as BulkRow;
}

/**
 * Which autocomplete name lists a kind invalidates. Views and
 * subsets are in none — `fetchNames` does not carry them.
 */
const INVALIDATES: Partial<Record<ObjKind, string[]>> = {
  cube: ['Cubes'],
  dimension: ['Dimensions', 'Hierarchies'],
  process: ['Processes'],
  chore: ['Chores'],
};

/**
 * The node that `tm1.findReferences` expects. Views and subsets have
 * no target there (`targetFromNode` knows cube, dimension, process, chore) —
 * for those it stays with the names in the column.
 *
 * `includeSystem` is fixed to `true`: the dependency column does not filter
 * control objects out, because `}Drill_test` breaks just like any other
 * process. Without the field the window followed the tree switch and showed exactly
 * the processes that someone clicked on it for.
 */
export function usageNode(kind: ObjKind, name: string, serverId: string): Tm1TreeNode | undefined {
  const none = vscode.TreeItemCollapsibleState.None;
  const meta = { serverId, includeSystem: true };
  switch (kind) {
    case 'cube':      return new Tm1TreeNode('cube', name, none, { ...meta, cubeName: name });
    case 'dimension': return new Tm1TreeNode('dimension', name, none, { ...meta, dimName: name });
    case 'process':   return new Tm1TreeNode('process', name, none, { ...meta, processName: name });
    case 'chore':     return new Tm1TreeNode('chore', name, none, { ...meta, choreName: name });
    default:          return undefined;
  }
}

export class BulkDeletePanel {
  private static host: WebviewPanelHost<WebviewToHost> | undefined;
  private static refreshTree: () => void = () => { /* set by initialize */ };
  /**
   * Follow-up work per deleted piece — the same as the single commands in the
   * tree do: close the rule or process panel, clean up "Recent". Without
   * it an open rule editor keeps writing after the delete under the
   * old name and hits a newly created cube of the same name.
   */
  private static afterDelete: (item: DeleteItem, cfg: Tm1Config, serverId: string) => void =
    () => { /* set by initialize */ };
  private static readonly cfgByKey = new Map<string, Tm1Config>();

  static initialize(
    extensionUri: vscode.Uri,
    refreshTree: () => void,
    afterDelete?: (item: DeleteItem, cfg: Tm1Config, serverId: string) => void,
  ): void {
    this.refreshTree = refreshTree;
    if (afterDelete) { this.afterDelete = afterDelete; }
    this.host = new WebviewPanelHost<WebviewToHost>('tm1.bulkDelete', 'Bulk Delete');
    this.host.initialize(extensionUri);
  }

  static disposeAll(): void { this.host?.disposeAll(); }

  /** Close this server's page (on disconnect). */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cfg: Tm1Config, serverId: string, displayName?: string): void {
    if (!this.host) { throw new Error('BulkDeletePanel not initialized'); }
    // Server URL FIRST — exactly the form that `disposePanelsForServer` finds on
    // disconnect; the profile behind it, so that two profiles on the same
    // instance do not share the same page (and thus the same `Tm1Config`).
    const key = `${cfg.serverUrl}::bulk#${serverId}`;
    this.cfgByKey.set(key, cfg);
    const label = displayName ?? cfg.serverUrl ?? '';

    this.host.open({
      key,
      title: vscode.l10n.t('Bulk Delete: {0}', label),
      html: (webview, extensionUri) => {
        const l10n = buildBulkDeleteL10n();
        l10n.title = vscode.l10n.t('Bulk Delete');
        return renderWebviewShell({
          cspSource: webview.cspSource,
          title: 'TM1 Bulk Delete',
          css: BULK_TABLE_CSS,
          body: body(l10n, label),
          globals: { __l10n: l10n },
          scriptUris: [String(webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'bulkDelete.js')))],
        });
      },
      onMessage: (msg, panel) =>
        BulkDeletePanel.onMessage(msg, panel, BulkDeletePanel.cfgByKey.get(key) ?? cfg, serverId),
      onDispose: () => { BulkDeletePanel.cfgByKey.delete(key); },
    });
  }

  private static async onMessage(
    msg: WebviewToHost,
    panel: vscode.WebviewPanel,
    cfg: Tm1Config,
    serverId: string,
  ): Promise<void> {
    const post = (out: HostToWebview): void => { void postTo<HostToWebview>(panel.webview, out); };
    const l10n = buildBulkDeleteL10n();

    // On open NOTHING is loaded — first the choice of kinds, then the
    // search. Otherwise everyone who merely opens the page pays for six lists.
    if (msg.type === 'ready') {
      post({ type: 'init', l10n, serverLabel: cfg.serverUrl ?? '', kinds: [...OBJ_KINDS] });
      return;
    }

    // No window of its own: `tm1.findReferences` already shows the references
    // grouped per source object, collapsed, with section and line — and
    // opens each source on click. The page only hands over kind and names.
    if (msg.type === 'openUsage') {
      const node = usageNode(msg.kind, msg.name, serverId);
      if (node) { await vscode.commands.executeCommand('tm1.findReferences', node); }
      return;
    }

    // The generation of the request goes back unchanged. The host
    // serializes nothing: two searches may answer in reverse order,
    // and the renderer uses the `gen` to recognize which answer still belongs to the
    // table it is showing.
    const gen = msg.gen;

    if (msg.type === 'search') {
      await handleBulkSearch(cfg, msg, l10n.loading, post);
      return;
    }

    // A request of its own: the reference index reads EVERY process text, EVERY
    // rule text and every chore of the server. That runs when someone asks
    // for it, not on the side with every search.
    if (msg.type === 'analyze') {
      post({ type: 'busy', on: true, label: l10n.analyzing, gen });
      try {
        const rows: BulkRow[] = msg.rows.map(r =>
          row(r.kind, r.name, r.parent, r.hierarchy));
        const { usage, incomplete, dynamicDataSources } = await loadUsage(cfg, rows);
        post({ type: 'usage', usage, incomplete, dynamicDataSources, gen });
      } catch (err) {
        post({ type: 'error', message: errMsg(err), gen });
      } finally {
        post({ type: 'busy', on: false, gen });
      }
      return;
    }

    if (msg.type !== 'delete') { return; }
    const items = sortForDelete(msg.items);
    if (items.length === 0) { return; }

    // The confirmation stays with the host: there is no `confirm()` in the webview
    // sandbox, and a home-made form would be the only place in the
    // program where an irreversible action ran without the system dialog.
    const DELETE = vscode.l10n.t('Delete');
    // With parent object and hierarchy: `• Default` twelve times in a row
    // does not say which twelve are meant.
    const detail = items.slice(0, 12).map(i => `• ${rowLabel(i)}`).join('\n')
      + (items.length > 12 ? `\n… +${items.length - 12}` : '');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Really delete {0} objects? This cannot be undone.', String(items.length)),
      { modal: true, detail },
      DELETE,
    );
    if (answer !== DELETE) { post({ type: 'busy', on: false, gen }); return; }

    post({ type: 'busy', on: true, label: l10n.deleting, gen });
    const outcomes: DeleteOutcome[] = [];
    const touchedKinds = new Set<ObjKind>();
    // Progress AND cancel: a run over hundreds of pieces used to show
    // only a fixed "Deleting…" in the window, and whoever closed the window
    // had a delete run continuing without any display (the host
    // swallows the `postMessage` after closing). For deleting this weighs
    // heavier than for transferring — there is no way back here.
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Deleting {0} objects…', String(items.length)),
      cancellable: true,
    }, async (progress, token) => {
      let done = 0;
      for (const item of items) {
        done++;
        // Cancel does NOT mean done: what is still standing counts as
        // skipped, otherwise the report names more deletions than there were.
        if (token.isCancellationRequested) {
          outcomes.push({ ...item, ok: true, skipped: true });
          continue;
        }
        progress.report({
          message: `${rowLabel(item)} (${done}/${items.length})`,
          increment: 100 / items.length,
        });
        try {
          await deleteOne(item, cfg);
          outcomes.push({ ...item, ok: true });
          // Only on success: a panel for an object that is still standing belongs
          // open.
          BulkDeletePanel.afterDelete(item, cfg, serverId);
        } catch (err) {
          // No exit on an ERROR: otherwise the selection hangs half
          // deleted in the air, and which half, one would have to guess. The
          // user's cancel above is something else — that one is intended.
          outcomes.push({ ...item, ok: false, reason: errMsg(err) });
        }
        touchedKinds.add(item.kind);
      }
    });

    for (const kind of touchedKinds) {
      for (const ep of INVALIDATES[kind] ?? []) { invalidateCache(ep, cfg.serverUrl); }
    }
    invalidateReferenceIndex(cfg);
    BulkDeletePanel.refreshTree();

    // `skipped` counts as NEITHER success NOR error: it is the remainder after
    // a cancel, and booking it under "deleted" would be the one
    // message after which nobody checks again.
    const ok = outcomes.filter(o => o.ok && !o.skipped).length;
    const skipped = outcomes.filter(o => o.skipped).length;
    const bad = outcomes.filter(o => !o.ok).length;
    if (bad === 0 && skipped > 0) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('TM1: cancelled — {0} deleted, {1} left untouched.',
          String(ok), String(skipped)));
    } else if (bad === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t('TM1: {0} objects deleted.', String(ok)));
    } else {
      const first = outcomes.filter(o => !o.ok).slice(0, 3)
        .map(o => `• ${rowLabel(o)}: ${o.reason ?? ''}`).join('\n');
      vscode.window.showWarningMessage(
        vscode.l10n.t('TM1: {0} deleted, {1} failed:', String(ok), String(bad)) + `\n${first}`
        + (skipped > 0
          ? `\n${vscode.l10n.t('{0} left untouched after cancelling.', String(skipped))}` : ''));
    }
    post({ type: 'done', outcomes });
    post({ type: 'busy', on: false, gen });
  }
}
