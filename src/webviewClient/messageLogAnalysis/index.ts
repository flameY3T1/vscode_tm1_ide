// src/webviewClient/messageLogAnalysis/index.ts
// Bundle of the Process Run Analysis window: DOM wiring around render.ts.
import type { CallNodeView, HostToWebview, MlaTexts, ProcStatView, WebviewToHost } from './protocol';
import { renderNode, renderStatsTable, type SortKey } from './render';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const L = (window as unknown as { __mlaL: MlaTexts }).__mlaL;

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/**
 * A .node is hidden when some ancestor .kids container sits under a
 * .collapsed node. Walk up from the node and check each .kids ancestor's
 * parent for the collapsed class.
 */
function isNodeHidden(node: Element): boolean {
  let el = node.parentElement;
  while (el) {
    if (el.classList.contains('kids')) {
      const owner = el.parentElement;
      if (owner && owner.classList.contains('collapsed')) { return true; }
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Re-assign zebra striping across the currently-visible .node rows in
 * DOM order. Called after every full render and after every collapse/
 * expand toggle, so stripes never go stale when subtrees hide/show.
 */
function restripe(): void {
  let idx = 0;
  byId('pane-tree').querySelectorAll('.node').forEach((node) => {
    if (isNodeHidden(node)) { node.classList.remove('row-odd'); return; }
    node.classList.toggle('row-odd', (idx % 2) === 1);
    idx++;
  });
}

function renderTree(trees: CallNodeView[]): void {
  byId('pane-tree').innerHTML = trees.length ? trees.map((n) => renderNode(n, L)).join('') : '<div class="empty-hint">–</div>';
  restripe();
}

let statsData: ProcStatView[] = [];
let sortKey: SortKey = 'totalSec';
let sortDir: 'asc' | 'desc' = 'desc';

function renderStats(): void {
  const pane = byId('pane-stats');
  pane.innerHTML = renderStatsTable(statsData, sortKey, sortDir, L);
  pane.querySelectorAll<HTMLElement>('th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k as SortKey;
    if (sortKey === k) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; } else { sortKey = k; sortDir = k === 'name' ? 'asc' : 'desc'; }
    renderStats();
  }));
}

const setPending = (): void => { byId('status').textContent = '…'; };

document.querySelectorAll<HTMLElement>('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  byId('pane-tree').classList.toggle('active', tab === 'tree');
  byId('pane-stats').classList.toggle('active', tab === 'stats');
}));

byId('pane-tree').addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLElement>('.errlog');
  if (link) {
    e.preventDefault();
    vscode.postMessage({ command: 'openErrorLog', file: link.dataset.file ?? '' });
    return;
  }
  const tw = (e.target as HTMLElement).closest<HTMLElement>('.tw');
  if (!tw) { return; }
  const node = tw.closest('.node');
  if (node && node.querySelector(':scope > .kids')) {
    node.classList.toggle('collapsed');
    tw.textContent = node.classList.contains('collapsed') ? '▶' : '▼';
    restripe();
  }
});

byId('depthSel').addEventListener('change', (e) => {
  vscode.postMessage({ command: 'setDepth', depth: Number((e.target as HTMLSelectElement).value) });
  setPending();
});

byId('hideCtrl').addEventListener('change', (e) => {
  vscode.postMessage({ command: 'setHideControl', hide: (e.target as HTMLInputElement).checked });
  setPending();
});

byId('refreshBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
  setPending();
});

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => {
  const { result, error, langHint } = ev.data;
  // Own message, own branch: the language hint arrives independently of the
  // fetch and carries neither result nor error — carrying on would mean
  // reading result.stats on undefined.
  if (langHint !== undefined) {
    byId('langhint').textContent = langHint;
    return;
  }
  const errorEl = byId('error');
  // Clear the pending marker on BOTH outcomes — otherwise a failed fetch leaves
  // '…' on screen forever.
  if (error) {
    errorEl.textContent = error;
    byId('status').textContent = '–';
    return;
  }
  if (!result) { return; }
  errorEl.textContent = '';
  statsData = result.stats;
  renderTree(result.trees);
  renderStats();
  byId('status').textContent =
    result.entryCount + ' ' + L.entries + ' → ' + result.parsedRuns + ' ' + L.runs + ', ' + result.ignoredLines + ' ' + L.ignored;
});
