import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { getServerNameByUrl, formatServerLabel } from '../serverState/state';
import { fetchMessageLogSlice } from './messageLog';
import { isStartupAnalysisAvailable } from '../messageLog/messageLogPure';
import { buildStartupHistory, analyzeStartup, STARTUP_BOUNDARY_FILTER, type StartupHistoryEntry, type StartupAnalysis } from './messageLogStartupPure';
import { mapLimit } from '../utils/mapLimit';
import { renderWebviewShell } from '../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../webviews/columnResize';
import { savedColumnWidths, rememberColumnWidths } from '../webviews/columnWidthStore';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import { errMsg } from '../utils/errMsg';
import { formatTreeError } from '../providers/tm1TreeDataProviderPure';
import { messageLogLanguageHint } from './messageLogLanguageHint';
import type { HostToWebview, MlsBootstrap, WebviewToHost } from '../webviewClient/messageLogStartup/protocol';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';

const host = new WebviewPanelHost<WebviewToHost>('tm1MessageLogStartup', 'ServerStartupAnalysis');

/**
 * Close all startup analyses for this server (on disconnect).
 *
 * The key was already right (`serverCfg.serverUrl`), it just had no caller:
 * `disposeMessageLogPanelForServer` only closes the log window itself, not
 * the two analyses next to it. They stayed open on disconnect, with the
 * `Tm1Config` in their closure (2026-08-30).
 */
export function disposeStartupAnalysisForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
  // The language cache is cleaned up by the process-run analysis (both views
  // share it); on disconnect both `dispose*` paths run anyway.
}

// Hangs off its own host — the disposer of the log window does not know it.
registerServerDisposer('startupAnalysis', (url) => disposeStartupAnalysisForServer(url));

/**
 * How far before the reported `ready` line to open the detail window.
 *
 * The reported total and the wall clock between `Data Directory:` and `ready`
 * agree to within a few seconds on every start measured (20 of 20 in a real log),
 * so a minute of slack finds the boundary line without dragging in the previous
 * start. Capped rows keep even a pathological window bounded.
 */
const WINDOW_MARGIN_SEC = 90;
const WINDOW_MAX_ROWS = 5000;
/** Startups offered in the picker. 55 exist in the live log; 40 is a page. */
const LIST_LIMIT = 40;
/** Up to three boundary lines per start (begin, ready, shutdown). */
const BOUNDARY_MAX_ROWS = 600;

/** Tests only: the rendered shell, to check the bundle wiring. */
export function _getHtmlForTest(webview: vscode.Webview, extensionUri: vscode.Uri, serverLabel = ''): string {
  return getHtml(webview, extensionUri, serverLabel);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, serverLabel: string): string {
  const css = `
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         margin: 0; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; flex-shrink: 0;
             border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  .toolbar .title { font-weight: 600; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent;
           padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .split { flex: 1 1 auto; min-height: 0; display: flex; }
  .list { width: 260px; flex-shrink: 0; overflow: auto; border-right: 1px solid var(--vscode-panel-border); }
  .list .row { padding: 6px 12px; cursor: pointer; border-bottom: 1px solid var(--vscode-editorGroup-border, rgba(128,128,128,0.14)); }
  .list .row:hover { background: var(--vscode-list-hoverBackground); }
  .list .row.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .list .when { font-size: 12px; font-variant-numeric: tabular-nums; }
  .list .tot { font-size: 11px; opacity: 0.8; font-variant-numeric: tabular-nums; }
  .list .end { font-size: 11px; opacity: 0.8; }
  .list .end.unlogged { color: var(--vscode-editorWarning-foreground, #cca700); opacity: 1; }
  .trend { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .trend .k { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .75; margin-bottom: 4px; }
  .trend .bars { display: flex; align-items: flex-end; gap: 2px; height: 48px; }
  .trend .bar { flex: 1 1 0; min-width: 2px; background: var(--vscode-charts-blue, #3794ff);
                border-radius: 2px 2px 0 0; cursor: pointer; }
  .trend .bar.sel { background: var(--vscode-focusBorder, #007fd4); }
  .trend .bar:hover { opacity: .8; }
  .trend .cov { font-size: 10px; opacity: .75; margin-top: 6px; line-height: 1.4; }
  .detail { flex: 1 1 auto; overflow: auto; padding: 12px 16px; min-width: 0; }
  h2 { font-size: 13px; margin: 18px 0 6px; font-weight: 600; }
  h2:first-child { margin-top: 0; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
  .kpi { border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 6px 10px; min-width: 118px; }
  .kpi .k { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .75; }
  .kpi .v { font-size: 15px; font-variant-numeric: tabular-nums; }
  .kpi .s { font-size: 10px; opacity: .7; }
  .note { font-size: 11px; opacity: .8; margin: 6px 0 0; max-width: 74ch; line-height: 1.45; }
  .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  th { text-align: left; font-weight: 600; padding: 3px 8px 3px 0; position: sticky; top: 0;
       background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: 2px 8px 2px 0; border-bottom: 1px solid var(--vscode-editorGroup-border, rgba(128,128,128,0.10)); }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .lane { display: flex; align-items: center; gap: 8px; margin: 3px 0; font-size: 11px; }
  .lane .lbl { width: 150px; flex-shrink: 0; font-variant-numeric: tabular-nums; opacity: .85; }
  .lane .track { flex: 1 1 auto; height: 16px; position: relative;
                 background: var(--vscode-editorGroup-border, rgba(128,128,128,0.14)); border-radius: 3px; }
  .lane .seg { position: absolute; top: 0; bottom: 0; background: var(--vscode-charts-blue, #3794ff);
               border-radius: 2px; min-width: 1px; }
  .lane .seg.hot { background: var(--vscode-charts-red, #f14c4c); }
  .lane.crit .lbl { font-weight: 600; opacity: 1; }
  .empty { opacity: .7; font-size: 12px; padding: 24px 0; }
  #error { color: var(--vscode-errorForeground); font-size: 12px; padding: 6px 16px; }
  /* Warning color, not an error: the view works, it just cannot read this
     server. The :empty rule hides the line together with its padding. */
  #langhint { color: var(--vscode-editorWarning-foreground); font-size: 12px; padding: 6px 16px; }
  #langhint:empty { display: none; }
  `;

  const body = `
  <div class="toolbar">
    <span class="title">${vscode.l10n.t('Server Startup Analysis')}${serverLabel ? ` · ${serverLabel}` : ''}</span>
    <span class="spacer"></span>
    <span id="status"></span>
    <button id="reload" class="primary">${vscode.l10n.t('Reload')}</button>
  </div>
  <div id="error"></div>
  <div id="langhint"></div>
  <div class="split">
    <div class="list" id="list"><div class="empty" style="padding:12px">${vscode.l10n.t('Loading…')}</div></div>
    <div class="detail" id="detail"></div>
  </div>`;

  const T: MlsBootstrap['texts'] = {
    noStartups: vscode.l10n.t('No server startup found in the message log.'),
    pick: vscode.l10n.t('Pick a startup on the left.'),
    reported: vscode.l10n.t('Reported total'),
    wall: vscode.l10n.t('Elapsed (measured)'),
    loadTime: vscode.l10n.t('Load time'),
    workers: vscode.l10n.t('Cube threads'),
    parallel: vscode.l10n.t('Max. parallel'),
    mtq: vscode.l10n.t('MTQ threads'),
    feeders: vscode.l10n.t('Feeders'),
    computed: vscode.l10n.t('computed'),
    fromFile: vscode.l10n.t('from file'),
    floor: vscode.l10n.t('Floor'),
    floorSub: vscode.l10n.t('longest thread'),
    budget: vscode.l10n.t('Where the time went'),
    prelude: vscode.l10n.t('Before the first load line'),
    bodies: vscode.l10n.t('Cube bodies (elapsed time covered)'),
    tail: vscode.l10n.t('After the last cube'),
    rest: vscode.l10n.t('Not attributed'),
    work: vscode.l10n.t('Work'),
    lanes: vscode.l10n.t('Thread lanes'),
    lane: vscode.l10n.t('Thread'),
    cubesTbl: vscode.l10n.t('Cube bodies'),
    cube: vscode.l10n.t('Cube'),
    dur: vscode.l10n.t('Duration'),
    share: vscode.l10n.t('Share'),
    feedersTbl: vscode.l10n.t('Computed feeders'),
    counted: vscode.l10n.t('Counted only (TM1 logs no end line for these)'),
    headers: vscode.l10n.t('Cube headers'),
    dims: vscode.l10n.t('Dimensions'),
    rules: vscode.l10n.t('Rules'),
    lines: vscode.l10n.t('lines in window'),
    clipped: vscode.l10n.t('{0} cube loads reach past the window edge and carry no duration.'),
    sumNote: vscode.l10n.t('Work is the sum of all cube loads; with several threads it exceeds the elapsed time. Covered time is the union of their intervals — that is the share of the startup actually spent loading cube bodies.'),
    floorNote: vscode.l10n.t('The longest thread sets the floor: no additional cube-loading thread can finish the startup before that one lane is done.'),
    trend: vscode.l10n.t('Startup duration over time'),
    endClean: vscode.l10n.t('Previous run: clean shutdown'),
    endUnlogged: vscode.l10n.t('Previous run: end not logged'),
    endUnknown: vscode.l10n.t('Previous run: not in the log'),
    down: vscode.l10n.t('down {0}'),
    // Without a shutdown line only the last line of any kind is known; an idle
    // server writes nothing for hours, so the gap is an upper bound.
    downMax: vscode.l10n.t('down at most {0}'),
    aborted: vscode.l10n.t('{0} aborted start attempts before'),
    coverage: vscode.l10n.t('The log reaches back to {0}. Only the current tm1server.log is readable over REST, rotated files are not.'),
    unloggedNote: vscode.l10n.t('End not logged: TM1 wrote no shutdown line. A killed process looks like this, and so does a crash. The log cannot tell them apart.'),
  };

  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: css + COLUMN_RESIZE_CSS,
    body,
    globals: { __mls: { texts: T } satisfies MlsBootstrap },
    scriptUris: [String(webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'messageLogStartup.js')))],
    // Column width via drag (webviews/columnResize.ts) runs after the bundle.
    inlineScript: columnResizeScript('messageLogStartup', savedColumnWidths('messageLogStartup')),
  });
}

/** Re-fetch hook per open panel, same reason as the process-run analysis. */
const refreshers = new Map<string, () => void>();

export async function showMessageLogStartupCommand(
  context: vscode.ExtensionContext,
  serverCfg: Tm1Config,
): Promise<void> {
  // v12 has no server log over REST, so a startup leaves nothing to read (see
  // `isStartupAnalysisAvailable`). Say so once instead of opening a panel that
  // can only ever show "no startup found".
  if (!isStartupAnalysisAvailable(serverCfg.version)) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('TM1 v12 does not expose the server log over REST — server startups cannot be analysed. Only per-run process and chore logs are available.'),
    );
    return;
  }
  host.initialize(context.extensionUri);
  const key = serverCfg.serverUrl;
  if (host.get(key)) {
    host.reveal(key);
    refreshers.get(key)?.();
    return;
  }

  const serverLabel = formatServerLabel(serverCfg.serverUrl, getServerNameByUrl) ?? '';
  let panelDisposed = false;
  let inFlight = false;

  function post(target: vscode.WebviewPanel, m: HostToWebview): void {
    if (panelDisposed) { return; }
    try { void postTo<HostToWebview>(target.webview, m); } catch { /* panel died mid-flight */ }
  }

  async function loadList(target: vscode.WebviewPanel): Promise<{ list: StartupHistoryEntry[]; fill: () => Promise<void> }> {
    // Cheap and precise: 55 ready lines came back in 4 KB / 138 ms on the live
    // server. Scanning a depth-limited tail instead would miss every startup
    // older than the tail, which is most of them. The boundary filter adds the
    // begin and shutdown lines: 3.5 KB / 1.4 s on a 656k-line log.
    const [rows, oldest] = await Promise.all([
      fetchMessageLogSlice(serverCfg, { top: BOUNDARY_MAX_ROWS, filter: STARTUP_BOUNDARY_FILTER }),
      // Oldest real line = how far back REST reaches. Only the current
      // tm1server.log is readable; rotated files are not (measured 2026-11-03).
      // Several rows because TM1 dates the shared-memory line 0000-00-00.
      fetchMessageLogSlice(serverCfg, { top: 5, ascending: true }),
    ]);
    const list = buildStartupHistory(rows).slice(0, LIST_LIMIT);
    const coverageFrom = oldest.map(e => e.TimeStamp ?? '').find(t => !Number.isNaN(Date.parse(t))) ?? null;
    post(target, { startups: list, coverageFrom });
    const gen = ++listGen;
    // Without a shutdown line the previous run's end is its last line of any
    // kind. One full log scan per start (~1.2 s each on a 656k-line log), so it
    // runs after the list and the detail are shown, two at a time to leave the
    // socket pool to the user's clicks. Best effort: a failed lookup leaves
    // that downtime empty.
    const fill = async (): Promise<void> => {
      const begins = list.filter(s => s.prevEnd === 'unlogged' && s.beginTs).map(s => s.beginTs as string);
      if (begins.length === 0) { return; }
      const lasts = await mapLimit(begins, 2, async (b) => {
        try {
          const r = await fetchMessageLogSlice(serverCfg, { top: 1, filter: `TimeStamp lt ${b}` });
          return [b, r[0]?.TimeStamp ?? null] as const;
        } catch { return [b, undefined] as const; }
      });
      if (gen !== listGen) { return; }
      const known = lasts.filter((e): e is readonly [string, string | null] => e[1] !== undefined);
      lastList = buildStartupHistory(rows, new Map(known)).slice(0, LIST_LIMIT);
      post(target, { startups: lastList, coverageFrom });
    };
    return { list, fill };
  }
  /** Bumped per list load, so a slow fill never overwrites a newer list. */
  let listGen = 0;

  async function loadDetail(target: vscode.WebviewPanel, readyTs: string): Promise<void> {
    const readyMs = Date.parse(readyTs);
    if (Number.isNaN(readyMs)) { return; }
    const ref = lastList.find(s => s.readyTs === readyTs);
    const span = (ref?.elapsedSec ?? 0) + WINDOW_MARGIN_SEC;
    const from = new Date(readyMs - span * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    const to = new Date(readyMs + 2000).toISOString().replace(/\.\d+Z$/, 'Z');
    const rows = await fetchMessageLogSlice(serverCfg, {
      top: WINDOW_MAX_ROWS,
      filter: `TimeStamp ge ${from} and TimeStamp le ${to}`,
      ascending: true,
    });
    const analysis: StartupAnalysis = analyzeStartup(rows);
    post(target, { analysis, status: '' });
  }

  let lastList: StartupHistoryEntry[] = [];

  async function refresh(target: vscode.WebviewPanel, readyTs?: string): Promise<void> {
    if (panelDisposed || inFlight) { return; }
    inFlight = true;
    post(target, { status: vscode.l10n.t('Loading…') });
    try {
      if (!readyTs) {
        const { list, fill } = await loadList(target);
        lastList = list;
        if (lastList.length === 0) { post(target, { analysis: null, status: '' }); return; }
        await loadDetail(target, lastList[0].readyTs);
        void fill();
      } else {
        await loadDetail(target, readyTs);
      }
    } catch (err) {
      post(target, { error: vscode.l10n.t(formatTreeError(err)), status: '' });
    } finally {
      inFlight = false;
    }
  }

  const panel = host.open({
    key,
    title: serverLabel
      ? `${serverLabel} : ${vscode.l10n.t('Server Startup Analysis')}`
      : vscode.l10n.t('Server Startup Analysis'),
    // ViewColumn: deliberate
    // A FIXED column on purpose, same reason as the process-run analysis: the
    // view is meant as side-by-side with the message log, which opens in
    // column two. Do NOT switch this to the host default `Active`.
    viewColumn: vscode.ViewColumn.Two,
    html: (webview, extensionUri) => getHtml(webview, extensionUri, serverLabel),
    onMessage: (m) => {
      if (panelDisposed) { return; }
      const p = host.get(key);
      if (!p) { return; }
      if (m.command === 'select' && m.readyTs) { void refresh(p, m.readyTs); }
      else if (m.command === 'reload') { void refresh(p); }
    },
    onError: (err) => {
      const p = host.get(key);
      if (p && !panelDisposed) { post(p, { error: errMsg(err) }); }
    },
    onDispose: () => { panelDisposed = true; refreshers.delete(key); },
  });
  if (!panel) { return; }
  rememberColumnWidths(panel, 'messageLogStartup');
  refreshers.set(key, () => { void refresh(panel); });
  void refresh(panel);

  // Concurrent: with a third server language no pattern matches, and the
  // empty list would otherwise be indistinguishable from "this server has
  // never been restarted".
  void messageLogLanguageHint(serverCfg).then((hint) => {
    if (!hint) { return; }
    const p = host.get(key);
    if (p) { post(p, { langHint: hint }); }
  });
}
