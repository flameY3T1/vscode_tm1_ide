import { setPanelIcon } from '../webviews/panelIcons';
import { muteWebviewOnDispose } from '../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { identityTag } from '../tm1Rest/transport/session';
import { listThreadsWithWaitChain, cancelThread as cancelThreadApi, cancelJob as cancelJobApi, disposeThreadPollAgent } from '../tm1Rest/threadApi';
import { buildWaitGraph, buildBlockerGroups, pickBlockerTargets, type BlockerTarget } from './lockChainPure';
import { pickDeployTarget } from './processEditor/deploy';
import { getServerConfig, getServerNameByUrl, formatServerLabel } from '../serverState/state';
import type { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { mapThreadToRow } from './threadsPure';
import { renderWebviewShell } from '../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../webviews/columnResize';
import { savedColumnWidths, rememberColumnWidths } from '../webviews/columnWidthStore';
import { errMsg } from '../utils/errMsg';
import { outputChannel } from '../utils/outputChannel';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview as ThreadsToWebview, ThreadsTexts, WebviewToHost } from '../webviewClient/threads/protocol';


// Lazy and grouped by name — created only on first access, and two modules
// with the same name share one channel.
const out = outputChannel('TM1 Threads');

/** Waiting thread targeted by "kill all waiting": State contains 'Wait' but not a debug-wait (Wait:DBG). */
function isWaiting(state: string | undefined): boolean {
  const s = state ?? '';
  return s.includes('Wait') && !s.includes('DBG');
}

/** Wire shape of a blocker target — the webview only needs what it displays. */
interface WireBlocker {
  id: string | number;
  label: string;
  waiterCount: number;
  fromCycle: boolean;
}

function toWireBlockers(targets: BlockerTarget[]): WireBlocker[] {
  return targets.map(t => ({
    id: t.id,
    label: blockerLabel(t),
    waiterCount: t.waiterCount,
    fromCycle: t.fromCycle,
  }));
}

/** `T42 (admin, 3 waiting)` — the text the confirmation dialog is built from. */
function blockerLabel(t: BlockerTarget): string {
  const id = typeof t.id === 'number' ? `T${t.id}` : String(t.id);
  const parts = [t.node?.name, t.node?.function].filter(Boolean).join(' · ');
  const waiters = vscode.l10n.t('{0} waiting', t.waiterCount);
  const dead = t.fromCycle ? `, ${vscode.l10n.t('deadlock')}` : '';
  return parts ? `${id} (${parts}, ${waiters}${dead})` : `${id} (${waiters}${dead})`;
}

/** Exported for the toolbar-wiring test — it runs the built bundle against this shell. */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, isV12: boolean): string {
  const t = vscode.l10n.t;
  // v12 exposes running work as "Jobs" (PAW "Activity" model), v11 as "Threads".
  // Use the right noun consistently across title, status line and empty states.
  const items = isV12 ? t('Jobs') : t('Threads');
  const css = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; }
  .toolbar .title { font-weight: 600; margin-right: 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
  .toolbar button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); border-color: transparent; }
  .toolbar button.toggled { background: var(--vscode-inputOption-activeBackground); color: var(--vscode-inputOption-activeForeground); }
  .toolbar button svg { width: 14px; height: 14px; flex-shrink: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; display: inline-block; flex-shrink: 0; }
  .dot.err { background: #f44336; }
  .dot.paused { background: #ff9800; }
  #status { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  #error { color: var(--vscode-errorForeground); padding: 4px 12px 8px; font-size: 12px; }

  .chains-section { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .chains-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .chains-empty { color: var(--vscode-descriptionForeground); font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .chains-empty::before { content: '\\2713'; color: #4caf50; }

  .cluster { margin-bottom: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; overflow: hidden; }
  .cluster.deadlock { border-color: rgba(244,67,54,0.6); }
  .cluster-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--vscode-editorGroupHeader-tabsBackground); font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .cluster.deadlock .cluster-head { background: rgba(244,67,54,0.10); }
  .blocker-id { font-weight: 700; font-size: 13px; color: #4caf50; }
  .cluster.deadlock .blocker-id { color: #f44336; }
  .blocker-name { color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .blocker-verb { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .blocker-count { margin-left: auto; font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .deadlock-badge { display: inline-block; background: rgba(244,67,54,0.12); color: #f44336; border: 1px solid rgba(244,67,54,0.5); border-radius: 3px; padding: 1px 6px; font-size: 10px; font-weight: 700; }
  table.cluster-rows { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.cluster-rows td { padding: 3px 10px; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
  table.cluster-rows tr:last-child td { border-bottom: none; }
  .cr-id { font-weight: 600; color: #ff9800; width: 1%; }
  .cr-cycle .cr-id { color: #f44336; }
  .cr-obj { color: var(--vscode-descriptionForeground); }
  .cr-wait { color: #ff9800; text-align: right; font-variant-numeric: tabular-nums; width: 1%; }
  button#btn-killwait, button#btn-killblocker { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
  button#btn-killwait:disabled, button#btn-killblocker:disabled { opacity: 0.4; cursor: default; }
  button#btn-killblocker.has-deadlock:not(:disabled) { background: rgba(244,67,54,0.12); font-weight: 600; }

  .content { padding: 8px 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead tr { background: var(--vscode-editorGroupHeader-tabsBackground); position: sticky; top: 0; }
  th { padding: 5px 8px; text-align: left; font-weight: 600; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; }
  td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .s-run  { color: #4caf50; font-weight: 600; }
  .s-wait { color: #ff9800; }
  .s-idle { color: var(--vscode-descriptionForeground); }
  .elapsed { font-variant-numeric: tabular-nums; }
  .sess { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); width: 1%; }
  button.kill { background: transparent; border: 1px solid var(--vscode-errorForeground); color: var(--vscode-errorForeground); border-radius: 3px; padding: 1px 6px; cursor: pointer; font-size: 11px; opacity: 0.7; }
  button.kill:hover { opacity: 1; }
`;
  const body = `
<div class="toolbar">
  <span class="title"><span class="dot" id="dot"></span>TM1 Server ${items}</span>
  <button id="btn-active-only" title="${t('Show only active threads (hide idle)')}">
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2.5h13l-5 6v5l-3 1.5v-6.5l-5-6z"/></svg>
    <span>${t('Active only')}</span>
  </button>
  <button id="btn-pause" title="${t('Pause/resume auto-refresh')}">
    <svg id="icon-pause" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3h2v10H5V3zm4 0h2v10H9V3z"/></svg>
    <svg id="icon-play" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path d="M4 3l9 5-9 5V3z"/></svg>
    <span id="lbl-pause">${t('Pause')}</span>
  </button>
  <button id="btn-refresh" title="${t('Refresh now')}">
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M 16.5 5 A 7 7 0 1 1 7.5 5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>
      <polygon points="14,4 19,4 16.5,9" fill="currentColor"/>
    </svg>
    <span>${t('Refresh')}</span>
  </button>
  <button id="btn-killwait" class="kill" title="${t('Cancel all waiting threads (excluding debug waits)')}" disabled>
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM4.5 7.25h7v1.5h-7v-1.5z"/></svg>
    <span>${t('Kill all waiting')}</span>
  </button>
  <button id="btn-killblocker" class="kill" title="${t('Cancel the thread(s) at the head of the lock-wait chains — the ones actually holding the locks')}" disabled>
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l6 3v4c0 3-2.5 5.3-6 6-3.5-.7-6-3-6-6v-4l6-3zm-.9 3.4v3.6h1.8V4.9H7.1zm0 4.9v1.7h1.8V9.8H7.1z"/></svg>
    <span id="lbl-killblocker">${t('Kill blockers')}</span>
  </button>
  <div class="spacer"></div>
  <span id="status">–</span>
</div>
<div id="error"></div>
<div class="chains-section">
  <div class="chains-title">${t('Lock-wait chains')}</div>
  <div id="chains"><span class="chains-empty">${isV12 ? t('No waiting jobs') : t('No waiting threads')}</span></div>
</div>
<div class="content">
<table data-resizable>
  <thead><tr>
    <th>ID</th><th title="${t('Stable login-session ID (does not rotate like the thread ID)')}">${t('Session')}</th><th>${t('Type')}</th><th>${t('User')}</th><th>${t('Context')}</th><th>${t('State')}</th><th>${t('Function')}</th><th>${t('Object')}</th><th>${t('Progress')}</th><th>${t('Runtime')}</th><th></th>
  </tr></thead>
  <tbody id="tbody"></tbody>
</table>
</div>
`;
  const l10n: ThreadsTexts = {
    items,
    pause: t('Pause'),
    resume: t('Resume'),
    paused: t('paused'),
    noWaitingThreads: isV12 ? t('No waiting jobs') : t('No waiting threads'),
    unknown: t('(unknown)'),
    blocks: t('blocks'),
    kill: t('Kill'),
    killBlockers: t('Kill blockers'),
    // `{0}` = waiting-thread count (filled client-side)
    waiting: t('{0} waiting'),
  };
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: css + COLUMN_RESIZE_CSS,
    body,
    globals: { __l10n: l10n },
    scriptUris: [String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'threads.js')))],
    // Column width via drag (webviews/columnResize.ts) runs after the bundle.
    inlineScript: columnResizeScript('threads', savedColumnWidths('threads')),
  });
}

const panels = new Map<string, vscode.WebviewPanel>();
const timers = new Map<string, NodeJS.Timeout>();

export function disposeThreadsPanelForServer(serverUrl: string): void {
  if (!serverUrl) { return; }
  const prefix = `${serverUrl}::`;
  for (const [key, panel] of [...panels]) {
    if (key.startsWith(prefix)) { panel.dispose(); }
  }
}

registerServerDisposer('threadsPanel', (url) => disposeThreadsPanelForServer(url));

export async function openThreadsPanelForConfig(context: vscode.ExtensionContext, cfg: Tm1Config): Promise<void> {
  // Identity tag: cancel acts with the panel's credentials, so one panel per profile.
  const key = `${cfg.serverUrl}::@${identityTag(cfg)}`;
  const existing = panels.get(key);
  if (existing) { existing.reveal(undefined, true); return; }

  const isV12 = cfg.version === 'v12';
  const itemsNoun = isV12 ? vscode.l10n.t('Jobs') : vscode.l10n.t('Threads');
  const serverLabel = formatServerLabel(cfg.serverUrl, getServerNameByUrl);
  const titleBase = `TM1 Server ${itemsNoun}`;
  const panel = vscode.window.createWebviewPanel(
    'tm1Threads',
    serverLabel ? `${serverLabel} : ${titleBase}` : titleBase,
    // ViewColumn: deliberate
    // FIXED column + preserveFocus on purpose: the thread monitor runs
    // permanently alongside the work and must not pull the focus away from
    // the editor. Do NOT switch this to the host default `Active`.
    { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')] }
  );
  setPanelIcon(panel, 'tm1Threads');
  muteWebviewOnDispose(panel);
  panels.set(key, panel);
  panel.webview.html = getHtml(panel.webview, context.extensionUri, isV12);
  rememberColumnWidths(panel, 'threads');

  const vscodeCfg = vscode.workspace.getConfiguration('tm1');
  const timeoutMs = vscodeCfg.get<number>('threadRefreshTimeoutMs') ?? 5000;

  let inFlight = false;
  async function refresh() {
    if (!panels.get(key)) { return; }
    // In-flight guard: prevents a request pile-up when the poll timer fires
    // while the previous fetch is still running against a slow server.
    if (inFlight) { return; }
    inFlight = true;
    try {
      const raw = await listThreadsWithWaitChain(cfg, timeoutMs);
      // Panel may have been disposed during the await (tab closed, window
      // reload). Posting to a disposed webview throws "Webview is disposed".
      if (!panels.get(key)) { return; }
      const graph = buildWaitGraph(raw);
      const groups = buildBlockerGroups(graph.nodes, graph.edges, graph.cycles);
      const blockers = toWireBlockers(pickBlockerTargets(graph));
      const threads = raw.map(t => ({ ...t, ...mapThreadToRow(t) }));
      const waitingCount = raw.filter(t => isWaiting(t.State)).length;
      postTo<ThreadsToWebview>(panel.webview, {
        groups,
        cycleIds: [...graph.cycles],
        threads,
        waitingCount,
        blockers,
        ts: Date.now(),
      });
    } catch (err) {
      if (!panels.get(key)) { return; }
      postTo<ThreadsToWebview>(panel.webview, { groups: [], cycleIds: [], threads: [], waitingCount: 0, blockers: [], error: errMsg(err), ts: Date.now() });
    } finally {
      inFlight = false;
    }
  }

  let paused = false;
  // Captured below; disposed on panel close so listener scoped to
  // panel instead of accumulating in context.subscriptions across reopens (F4).
  const msgSub = panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
    if (msg.command === 'setPaused') {
      paused = !!msg.paused;
      const t = timers.get(key);
      if (paused) {
        if (t) { clearInterval(t); timers.delete(key); }
      } else {
        const ms = Math.max(vscode.workspace.getConfiguration('tm1').get<number>('threadRefreshMs') ?? 2000, 250);
        if (!timers.get(key)) { timers.set(key, setInterval(() => { void refresh(); }, ms)); }
        void refresh();
      }
      return;
    }
    if (msg.command === 'manualRefresh') { void refresh(); return; }
    if (msg.command === 'kill') {
      // v11 targets a numeric worker thread; v12 targets a Job (GUID string).
      const jobId: string | undefined = msg.jobId;
      const id: number | undefined = msg.threadId;
      const label = jobId ?? String(id);
      const CANCEL = vscode.l10n.t('Yes, cancel');
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Really cancel thread {0}?', label), { modal: true }, CANCEL
      );
      if (confirm !== CANCEL) { return; }
      try {
        if (jobId) { await cancelJobApi(cfg, jobId); } else { await cancelThreadApi(cfg, id!); }
        out.appendLine(`[kill] ${jobId ? 'Job' : 'Thread'} ${label} cancelled`);
        vscode.window.showInformationMessage(vscode.l10n.t('Thread {0} was cancelled.', label));
      } catch (err) {
        out.appendLine(`[kill] error: ${errMsg(err)}`);
        vscode.window.showErrorMessage(vscode.l10n.t('Thread {0} could not be cancelled: {1}', label, errMsg(err)));
      }
      return;
    }
    if (msg.command === 'killBlockers') {
      // Re-read instead of trusting the payload the button was rendered from:
      // it is up to one poll interval old, and a blocker that finished in the
      // meantime would take an unrelated thread's place under the same id.
      let targets: BlockerTarget[];
      try {
        const raw = await listThreadsWithWaitChain(cfg, timeoutMs);
        targets = pickBlockerTargets(buildWaitGraph(raw));
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Could not read threads: {0}', errMsg(err)));
        return;
      }
      if (targets.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('Nothing is blocking right now.'));
        void refresh();
        return;
      }
      const yes = vscode.l10n.t('Yes, cancel');
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Cancel {0} blocking thread(s)?', targets.length),
        { modal: true, detail: targets.map(blockerLabel).join('\n') },
        yes,
      );
      if (confirm !== yes) { return; }
      let ok = 0;
      const failed: string[] = [];
      for (const b of targets) {
        // A numeric id is a v11 worker thread, a string id a v12 Job GUID —
        // the same split `buildWaitGraph` used to key the node.
        const label = typeof b.id === 'number' ? `T${b.id}` : String(b.id);
        try {
          if (typeof b.id === 'number') { await cancelThreadApi(cfg, b.id); }
          else { await cancelJobApi(cfg, b.id); }
          ok++;
          out.appendLine(`[killBlocker] ${label} cancelled (${b.waiterCount} waiting${b.fromCycle ? ', deadlock' : ''})`);
        } catch (err) {
          failed.push(label);
          out.appendLine(`[killBlocker] ${label} failed: ${errMsg(err)}`);
        }
      }
      if (failed.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('{0} blocking thread(s) cancelled.', ok));
      } else {
        out.show(true);
        vscode.window.showWarningMessage(vscode.l10n.t('{0} cancelled, {1} failed (IDs: {2}).', ok, failed.length, failed.join(', ')));
      }
      void refresh();
      return;
    }
    if (msg.command === 'killAllWaiting') {
      let waiting: Array<{ id?: number; jobId?: string; label: string }>;
      try {
        const raw = await listThreadsWithWaitChain(cfg, timeoutMs);
        waiting = raw.filter(t => isWaiting(t.State)).map(t => ({ id: t.ID, jobId: t.JobId, label: t.JobId ?? String(t.ID) }));
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Could not read threads: {0}', errMsg(err)));
        return;
      }
      if (waiting.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No waiting threads to cancel.'));
        return;
      }
      const yesLabel = vscode.l10n.t('Yes, cancel all');
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Cancel {0} waiting thread(s) (excluding debug waits)?', waiting.length),
        { modal: true }, yesLabel
      );
      if (confirm !== yesLabel) { return; }
      let ok = 0;
      const failed: string[] = [];
      for (const w of waiting) {
        try {
          if (w.jobId) { await cancelJobApi(cfg, w.jobId); } else { await cancelThreadApi(cfg, w.id!); }
          ok++;
          out.appendLine(`[killAll] ${w.jobId ? 'Job' : 'Thread'} ${w.label} cancelled`);
        } catch (err) {
          failed.push(w.label);
          out.appendLine(`[killAll] ${w.jobId ? 'Job' : 'Thread'} ${w.label} failed: ${errMsg(err)}`);
        }
      }
      if (failed.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('{0} waiting thread(s) cancelled.', ok));
      } else {
        out.show(true);
        vscode.window.showWarningMessage(vscode.l10n.t('{0} cancelled, {1} failed (IDs: {2}).', ok, failed.length, failed.join(', ')));
      }
      void refresh();
      return;
    }
  });

  const refreshIntervalMs = Math.max(vscode.workspace.getConfiguration('tm1').get<number>('threadRefreshMs') ?? 2000, 250);
  void refresh();
  timers.set(key, setInterval(() => { void refresh(); }, refreshIntervalMs));

  // P1-8: stop polling while the panel sits in a hidden tab — see same
  // pattern (former `serverHealth.ts`). Respects the manual `paused` flag so a
  // user-paused panel doesn't accidentally resume on tab focus.
  const viewStateSub = panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.visible) {
      if (!paused && !timers.get(key)) {
        const ms = Math.max(vscode.workspace.getConfiguration('tm1').get<number>('threadRefreshMs') ?? 2000, 250);
        timers.set(key, setInterval(() => { void refresh(); }, ms));
        void refresh();
      }
    } else {
      const t = timers.get(key);
      if (t) { clearInterval(t); timers.delete(key); }
    }
  });

  panel.onDidDispose(() => {
    const t = timers.get(key);
    if (t) { clearInterval(t); }
    timers.delete(key);
    panels.delete(key);
    // Scope the panel's listeners to the panel lifetime (F4): dispose here
    // instead of leaking them into context.subscriptions across reopens.
    msgSub.dispose();
    viewStateSub.dispose();
    // Tear down the dedicated poll socket so it isn't left open after close.
    disposeThreadPollAgent(cfg);
  }, null, context.subscriptions);
}

export async function showThreadsCommand(context: vscode.ExtensionContext, node?: Tm1TreeNode): Promise<void> {
  const nodeServerId = node?.meta?.serverId as string | undefined;
  const serverCfg = nodeServerId ? getServerConfig(nodeServerId) : await pickDeployTarget();
  if (!serverCfg) { return; }
  await openThreadsPanelForConfig(context, serverCfg);
}
