import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { getServerNameByUrl, formatServerLabel } from '../serverState/state';
import { fetchMessageLogEntries, openErrorLog } from './messageLog';
import { analyze, onlyChoreRuns, withoutControlRuns } from '../messageLog/messageLogAnalysisPure';
import { renderWebviewShell } from '../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../webviews/columnResize';
import { savedColumnWidths, rememberColumnWidths } from '../webviews/columnWidthStore';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import { errMsg } from '../utils/errMsg';
import { messageLogLanguageHint, clearLanguageHintCache } from './messageLogLanguageHint';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview, MlaTexts, WebviewToHost } from '../webviewClient/messageLogAnalysis/protocol';

// Standard panel lifecycle (key/reveal/open/dispose) — also supplies the
// `localResourceRoots` the hand-rolled panel was missing.
const host = new WebviewPanelHost<WebviewToHost>('tm1MessageLogAnalysis', 'ProcessRunAnalysis');

/**
 * Close all process-run analyses for this server (on disconnect).
 *
 * The key was already right (`serverCfg.serverUrl`), it just had no caller:
 * `disposeMessageLogPanelForServer` only closes the log window itself, not
 * the two analyses next to it. They stayed open on disconnect, with the
 * `Tm1Config` in their closure (2026-08-30).
 */
export function disposeProcessRunAnalysisForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
  // The cached server language belongs to the connection, not the panel: after
  // a disconnect the same user might set up the instance anew, and a server
  // restart with a different `tm1s.cfg` sits right in between.
  clearLanguageHintCache(serverUrl);
}

// Hangs off its own host — the disposer of the log window does not know it.
registerServerDisposer('processRunAnalysis', (url) => disposeProcessRunAnalysisForServer(url));

/** Tests only: the rendered shell, to check the bundle wiring. */
export function _getHtmlForTest(webview: vscode.Webview, extensionUri: vscode.Uri, currentTop: number): string {
  return getHtml(webview, extensionUri, currentTop);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, currentTop: number): string {
  const css = `
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  :root {
    --mla-grid-line: var(--vscode-editorGroup-border, rgba(128,128,128,0.18));
    --mla-grid-line-strong: var(--vscode-panel-border, rgba(128,128,128,0.45));
    --mla-header-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --mla-zebra: rgba(127,127,127,0.04);
    --mla-row-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.10));
    --mla-accent: var(--vscode-charts-blue, #3794ff);
    --mla-accent-soft: color-mix(in srgb, var(--mla-accent) 16%, transparent);
  }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--mla-grid-line-strong); background: var(--mla-header-bg); flex-shrink: 0; flex-wrap: wrap; }
  .toolbar .title { font-weight: 600; margin-right: 8px; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  .tab { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; border-bottom: 2px solid transparent; padding: 4px 12px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; }
  .tab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .tab.active { border-bottom-color: var(--mla-accent); color: var(--vscode-foreground); font-weight: 600; }
  .toolbar button.icon-btn { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .toolbar button.icon-btn:active { background: var(--vscode-toolbar-activeBackground, rgba(128,128,128,0.28)); }
  .toolbar select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--mla-grid-line-strong)); padding: 3px 6px; font-size: 12px; border-radius: 2px; }
  .toolbar select:focus { outline: 1px solid var(--vscode-focusBorder); }
  .toolbar label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  #status { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  #error { color: var(--vscode-errorForeground); padding: 4px 12px 8px; font-size: 12px; flex-shrink: 0; }
  /* Not an error but a classification — hence the warning color and not the
     error color. The :empty rule instead of an attribute, so that an empty text
     makes the line disappear together with its padding. */
  #langhint { color: var(--vscode-editorWarning-foreground); padding: 4px 12px 8px; font-size: 12px; flex-shrink: 0; }
  #langhint:empty { display: none; }
  /* Padding lives on the panes, not on the scroll container: with padding-top the
     sticky stats header docks below the scrollport edge and rows scroll through
     the gap above it. */
  .content { padding: 0; overflow: auto; flex: 1 1 auto; min-height: 0; }
  .pane { display: none; }
  .pane.active { display: block; }
  #pane-tree { padding: 8px 12px; }
  .empty-hint { color: var(--vscode-descriptionForeground); font-style: italic; padding: 4px 0; }

  /* ── Call tree: CSS-grid rows so runtime columns align across all depths ── */
  .node {
    display: grid;
    grid-template-columns: 1fr auto 64px 72px 110px;
    column-gap: 8px;
    align-items: center;
    padding: 1px 4px;
    border-radius: 2px;
    white-space: nowrap;
  }
  .node:hover { background: var(--mla-row-hover); }
  .node.row-odd { background: var(--mla-zebra); }
  .node.row-odd:hover { background: var(--mla-row-hover); }
  .node .tw { display: inline-block; width: 14px; cursor: pointer; color: var(--vscode-descriptionForeground); user-select: none; flex-shrink: 0; }
  .node .nm-cell { display: flex; align-items: center; gap: 4px; overflow: hidden; min-width: 0; }
  .node .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .node .ts { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
  .node .errlog { color: var(--vscode-textLink-foreground); flex-shrink: 0; }
  .node .errtext { color: var(--vscode-editorError-foreground, #e51400); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .node .incl { text-align: right; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
  .node .bar-track { width: 72px; height: 6px; background: var(--mla-grid-line); border-radius: 3px; overflow: hidden; }
  .node .bar-fill { display: block; height: 100%; background: var(--mla-accent); border-radius: 3px; }
  .node .self { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-badge { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 3px; font-size: 10px; flex-shrink: 0; }
  .st-ok { color: var(--vscode-charts-green, #4caf50); background: color-mix(in srgb, var(--vscode-charts-green, #4caf50) 16%, transparent); }
  .st-error { color: var(--vscode-editorError-foreground, #e51400); background: color-mix(in srgb, var(--vscode-editorError-foreground, #e51400) 16%, transparent); }
  .st-running { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-descriptionForeground) 16%, transparent); }
  .st-orphan { color: var(--vscode-editorWarning-foreground, #d7ba7d); background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 16%, transparent); }
  /* A chore row is a container for the processes it launched, not a timed run. */
  .st-group { color: var(--mla-accent); background: var(--mla-accent-soft); }
  /* Data-quality markers: the analyzer could not vouch for the number next to them. */
  .node .mark { font-size: 10px; line-height: 14px; padding: 0 3px; border-radius: 3px; flex-shrink: 0; cursor: help; }
  .mk-amb, .mk-trunc { color: var(--vscode-editorWarning-foreground, #d7ba7d); background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 16%, transparent); }
  .mk-inc { color: var(--vscode-editorError-foreground, #e51400); background: color-mix(in srgb, var(--vscode-editorError-foreground, #e51400) 16%, transparent); }
  .mk-async { color: var(--vscode-charts-blue, #3794ff); }
  /* The group row is a bracket, not an execution — more subdued than a real
     run, so that it does not outshine the children next to it. */
  .async-group > .nm-cell > .nm { font-style: italic; }
  .short-hint { color: var(--vscode-descriptionForeground); font-style: italic; padding-left: 18px; }
  .kids { grid-column: 1 / -1; margin-left: 16px; border-left: 1px dotted var(--mla-grid-line-strong); padding-left: 6px; }
  .collapsed > .kids { display: none; }

  /* ── Statistics table ── */
  table { min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
  /* Sticky sits on the cells, not the row — a stuck <tr> leaves its background
     and border behind, so rows bleed through the header while scrolling. */
  th {
    position: sticky; top: 0; z-index: 2;
    background: var(--mla-header-bg);
    padding: 5px 8px; text-align: right; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground);
    box-shadow: inset 0 -2px 0 var(--mla-grid-line-strong);
    white-space: nowrap; cursor: pointer;
  }
  th:first-child, td:first-child { padding-left: 12px; }
  th:last-child, td:last-child { padding-right: 12px; }
  th:hover { color: var(--vscode-foreground); }
  th:first-child { text-align: left; }
  th .sort-arrow { margin-left: 3px; color: var(--mla-accent); }
  td { padding: 4px 8px; border-bottom: 1px solid var(--mla-grid-line); white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
  td:first-child { text-align: left; font-weight: 600; }
  tbody tr.row-odd td { background: var(--mla-zebra); }
  tr:hover td { background: var(--mla-row-hover); }
  tbody tr.row-odd:hover td { background: var(--mla-row-hover); }
  .stat-fail { color: var(--vscode-editorError-foreground, #e51400); font-weight: 700; }
  .stat-uncertain { color: var(--vscode-editorWarning-foreground, #d7ba7d); font-weight: 700; cursor: help; }
`;
  // 2000 is here because a server restart floods the log: one startup on the live
  // 11.8 test server wrote ~900 lines, so a 500-deep window landed entirely inside
  // it and showed a single run. Measured against that log (2026-08-25):
  // $top=500 -> 1 run, 1000 -> 5, 2000 -> 107. Payload 94 / 184 / 384 KB.
  const depthOptions = Array.from(new Set([100, 200, 500, 1000, 2000, currentTop])).sort((a, b) => a - b);
  const depthOptionsHtml = depthOptions
    .map((d) => `<option value="${d}"${d === currentTop ? ' selected' : ''}>${d}</option>`)
    .join('\n    ');
  const body = `
<div class="toolbar">
  <span class="title">${vscode.l10n.t('Process Run Analysis')}</span>
  <button class="tab active" data-tab="tree">${vscode.l10n.t('Call Tree')}</button>
  <button class="tab" data-tab="stats">${vscode.l10n.t('Statistics')}</button>
  <label>${vscode.l10n.t('Entries')} <select id="depthSel">
    ${depthOptionsHtml}
  </select></label>
  <button id="refreshBtn" class="icon-btn" title="${vscode.l10n.t('Refresh')}">⟳ ${vscode.l10n.t('Refresh')}</button>
  <label title="${vscode.l10n.t('Hide runs of control processes and chores whose name starts with }')}"><input type="checkbox" id="hideCtrl" checked /> ${vscode.l10n.t('Hide } processes')}</label>
  <div class="spacer"></div>
  <span id="status">–</span>
</div>
<div id="error"></div>
<div id="langhint"></div>
<div class="content">
  <div class="pane active" id="pane-tree"></div>
  <div class="pane" id="pane-stats"></div>
</div>
`;
  const L: MlaTexts = {
    running: vscode.l10n.t('running'),
    proc: vscode.l10n.t('Process'),
    calls: vscode.l10n.t('Calls'),
    fail: vscode.l10n.t('Errors'),
    entries: vscode.l10n.t('entries'),
    runs: vscode.l10n.t('runs'),
    ignored: vscode.l10n.t('ignored'),
    uncertain: vscode.l10n.t('Uncertain'),
    ambigTip: vscode.l10n.t('Runtime uncertain: several runs of this process were open at the same time, so this time may belong to another run.'),
    uncExcluded: vscode.l10n.t('Not included in the time columns:'),
    truncTip: vscode.l10n.t('The start of this run is outside the fetched log entries — runtime only, start time unknown.'),
    incTip: vscode.l10n.t('Runtimes do not add up: the sub-processes report more time than this run.'),
    choreTip: vscode.l10n.t('Chore — container for the processes it launched. Any time shown is the scheduler run, not a process runtime, and is left out of the statistics.'),
    asyncRuns: vscode.l10n.t('{0} asynchronous runs'),
    asyncTip: vscode.l10n.t('Started asynchronously (RunProcess) — matched by time window and originator, not by a log link. Their time is NOT part of the caller\'s runtime.'),
    shortHidden: vscode.l10n.t('{0} short runs under {1} s not listed'),
    errorLog: vscode.l10n.t('Error log'),
  };
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: css + COLUMN_RESIZE_CSS,
    body,
    globals: { __mlaL: L },
    scriptUris: [String(webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'messageLogAnalysis.js')))],
    // Column width via drag (webviews/columnResize.ts) runs after the bundle.
    inlineScript: columnResizeScript('messageLogAnalysis', savedColumnWidths('messageLogAnalysis')),
  });
}

function clampTop(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 5000) : 100;
}

/**
 * Re-fetch hook per open panel. `WebviewPanelHost` reveals an existing panel but
 * knows nothing about its data, so a second "Analyze" click would show whatever
 * was fetched when the panel opened — arbitrarily stale (M4).
 */
const refreshers = new Map<string, () => void>();

export async function showMessageLogAnalysisCommand(
  context: vscode.ExtensionContext,
  serverCfg: Tm1Config,
  initialTop = 100,
  /** Show only this chore's runs — opened from the chore's tree node. */
  chore?: string,
): Promise<void> {
  host.initialize(context.extensionUri);
  // `::` keeps disposePanelsForServer matching the chore panel on disconnect.
  const key = chore ? `${serverCfg.serverUrl}::chore::${chore}` : serverCfg.serverUrl;
  if (host.get(key)) {
    // Reveal AND re-fetch: the run list has moved on since the panel was opened.
    // The panel's own depth dropdown stays authoritative, so `initialTop` from the
    // message-log panel is deliberately not re-applied here.
    host.reveal(key);
    refreshers.get(key)?.();
    return;
  }

  const serverLabel = formatServerLabel(serverCfg.serverUrl, getServerNameByUrl);
  let currentTop = clampTop(initialTop);
  // Matches the checkbox default in the markup.
  let hideControl = true;

  let inFlight = false;
  /** A refresh was requested while a fetch was running — the running one is stale. */
  let pending = false;

  /**
   * `postMessage` on a disposed panel throws (`ExtHostWebviewPanel.webview` asserts
   * not-disposed). The panel can be closed at any await point of `refresh`, and in
   * the catch path a second throw would reject `void refresh()` unhandled.
   */
  function post(target: vscode.WebviewPanel, msg: HostToWebview): void {
    try {
      // Disposal throws synchronously; a delivery failure rejects asynchronously —
      // swallow both, this is a best-effort UI update.
      Promise.resolve(postTo<HostToWebview>(target.webview, msg)).catch(() => { /* not delivered */ });
    } catch { /* panel disposed mid-flight */ }
  }

  async function refresh(): Promise<void> {
    // Identity, not presence: `host.get(key)` is truthy again as soon as the user
    // re-opens the panel for the same server (key = serverUrl) while this fetch is
    // still running, and the stale closure would then post to the DISPOSED panel.
    const panel = host.get(key);
    if (!panel) { return; }
    // Do NOT drop the request: the caller may have raised the depth, and returning
    // here left `currentTop` at the new value with no fetch ever issued and the
    // status stuck on '…' (M4). Queue it instead — the last request wins.
    if (inFlight) { pending = true; return; }
    inFlight = true;
    try {
      do {
        pending = false;
        const entries = await fetchMessageLogEntries(currentTop, serverCfg, { hideControl, chore });
        if (host.get(key) !== panel) { return; }
        // Depth changed mid-flight → this payload is for the wrong depth; discard
        // it and fetch again with the current one.
        if (pending) { continue; }
        const result = analyze(entries);
        post(panel, { result: chore ? onlyChoreRuns(result, chore)
          : hideControl ? withoutControlRuns(result) : result });
      } while (pending);
    } catch (err) {
      if (host.get(key) !== panel) { return; }
      post(panel, { error: errMsg(err) });
    } finally {
      inFlight = false;
    }
  }

  const panel = host.open({
    key,
    title: [serverLabel, vscode.l10n.t('Process Run Analysis'), chore].filter(Boolean).join(' : '),
    // ViewColumn: deliberate
    // A FIXED column on purpose: the analysis is meant as a side-by-side
    // layout with the message log, which itself opens in column two. Do NOT
    // switch this to the host default `Active` — that put both on top of
    // each other in the same group.
    viewColumn: vscode.ViewColumn.Two,
    html: (webview) => getHtml(webview, context.extensionUri, currentTop),
    onMessage: (msg) => {
      switch (msg.command) {
        case 'setDepth': currentTop = clampTop(Number(msg.depth)); void refresh(); break;
        case 'setHideControl': hideControl = msg.hide === true; void refresh(); break;
        case 'refresh': void refresh(); break;
        case 'openErrorLog': if (msg.file) { void openErrorLog(msg.file, serverCfg); } break;
      }
    },
    onDispose: () => { refreshers.delete(key); },
  });
  if (!panel) { return; }
  rememberColumnWidths(panel, 'messageLogAnalysis');
  refreshers.set(key, () => { void refresh(); });

  void refresh();

  // Concurrent with the first fetch: the hint does not hold up the analysis,
  // and without it a server with a third language can't be told apart from
  // one with no runs.
  void messageLogLanguageHint(serverCfg).then((hint) => {
    if (!hint) { return; }
    const p = host.get(key);
    if (p) { post(p, { langHint: hint }); }
  });
}
