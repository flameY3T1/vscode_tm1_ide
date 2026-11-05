import { setPanelIcon } from '../webviews/panelIcons';
import { muteWebviewOnDispose } from '../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import { apiRequest, assertOk } from '../tm1Client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { pickDeployTarget } from './processEditor/deploy';
import { getServerConfig, getServerNameByUrl, formatServerLabel } from '../serverState/state';
import type { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { mapLogEntry, buildLevelFilter, isStartupAnalysisAvailable } from '../messageLog/messageLogPure';
import type { RawEntry } from '../messageLog/messageLogAnalysisPure';
import { renderWebviewShell } from '../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../webviews/columnResize';
import { savedColumnWidths, rememberColumnWidths } from '../webviews/columnWidthStore';
import { errMsg } from '../utils/errMsg';
import { formatTreeError } from '../providers/tm1TreeDataProviderPure';
import { encodeODataKey } from '../utils/odataKey';
import { parseBody } from '../tm1Rest/parseRest';
import { fetchV12RunLogEntries, clearV12RunLogCache } from '../messageLog/messageLogV12';
import { isOk } from '../tm1Rest/httpError';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview as MessageLogToWebview, WebviewToHost } from '../webviewClient/messageLog/protocol';

/** Host → the inline script of the message log; no `entries` = keep the last table. */
/**
 * One `MessageLogEntries` row. Field names are the wire names; `RawEntry` carries
 * the two spellings TM1 uses for timestamp / message. Typed instead of `any[]`:
 * this is a cross-module seam (`messageLogAnalysis.ts` feeds the array straight
 * into `analyze()`), and `any[]` lets a field rename type-check while degrading at
 * runtime to empty start times and 100 % ignored lines (M7).
 */
export interface MessageLogEntry extends RawEntry {
  Logger?: string;
}

/**
 * The single row that stands in for an EMPTY v12 result.
 *
 * v12 has no message log to query (see `messageLogV12Pure.ts`); what it has is
 * one run-log file per process/chore execution, and those are what the panel
 * shows there. When not even those exist — a database nobody has run anything on
 * — an empty table would look like a broken panel, so say what is and is not
 * available instead. Only reached on the empty case: a v12 server WITH runs shows
 * its runs, not a notice.
 */
function v12EmptyNotice(): MessageLogEntry[] {
  return [{
    TimeStamp: new Date().toISOString(),
    Logger: 'TM1.RESTAPI',
    Level: 'WARNING',
    Message: vscode.l10n.t('TM1 v12 serves no message log over REST (removed in 12.0) — this panel shows the per-run process and chore logs instead, and none exist yet. Server-level lines and TI LogOutput (logger TM1.TILogOutput) stay in the server-side log files, which the REST API does not expose.'),
  }];
}

/**
 * Fetch the newest `top` message-log rows, optionally narrowed server-side.
 *
 * `levelFilter` is an OData `$filter` from `buildLevelFilter`. It is what makes
 * the depth setting count MATCHING rows: on the live 11.8 server 5679 of 54017
 * lines are errors, so sieving the last 100 rows in the webview typically shows
 * none, while `$top=100` over a level filter reaches two days back for the same
 * 0,02 MB and 94 ms.
 */
export async function fetchMessageLogEntries(
  top: number,
  config: Tm1Config,
  opts: { levelFilter?: string; levels?: Record<string, boolean>; hideControl?: boolean; chore?: string } = {},
): Promise<MessageLogEntry[]> {
  const { levelFilter, levels, hideControl, chore } = opts;
  // TM1 v12 removed message-log RETRIEVAL from the REST API (deprecated in 12.0):
  // MessageLogEntries, the MessageLog() function, the TailMessageLog() delta flow
  // and the Processes('X')/ErrorLogs navigation all answer empty — re-measured live
  // on 12.5.9, 2026-08-26 (v12LogSurfaceProbe.js). What remains is one run-log file per execution, so read
  // those instead of showing a permanently empty panel.
  if (config?.version === 'v12') {
    const res = await fetchV12RunLogEntries(config, { top, levels, hideControl, chore });
    return res.entries.length > 0 ? res.entries : v12EmptyNotice();
  }
  const refreshMs = Math.max(vscode.workspace.getConfiguration('tm1').get<number>('messageLogRefreshMs') ?? 5000, 250);
  const get = async (filter?: string) => await apiRequest(
    'GET',
    'MessageLogEntries?$orderby=TimeStamp desc&$top=' + top
      + (filter ? '&$filter=' + encodeURIComponent(filter) : ''),
    undefined,
    refreshMs,
    config,
  );

  let res = await get(levelFilter);
  if (levelFilter && (!isOk(res))) {
    // The enum literal is version-specific (`ibm.tm1.api.v1.LogLevel`, read off
    // 11.8's $metadata). A server that spells it differently rejects the query
    // LOUDLY — 11.8 answers a wrong enum type name with HTTP 501 "functionExpr
    // not currently supported" — so the failure is distinguishable and worth one
    // unfiltered retry. The webview sieves by level anyway, so the fallback
    // degrades to the old behaviour (shallow window) rather than to an error.
    res = await get(undefined);
  }
  assertOk(res);
  // parseBody (not a raw JSON.parse): at $top=5000 the payload is multiple MB and
  // the raw string would stay alive next to the parsed array — parse + release in
  // one step, see docs/architecture/memory-optimizations.md "General pattern".
  return parseBody<{ value?: MessageLogEntry[] }>(res).value ?? [];
}

/**
 * Fetch an arbitrary slice of the message log.
 *
 * `fetchMessageLogEntries` above is the poll path and hard-wires newest-first
 * plus the panel's depth. The startup view needs neither: it asks for a time
 * WINDOW in chronological order, because a startup is read forwards and its
 * length is set by the window, not by a row count.
 *
 * v12 throws here rather than answering rows: the only v12 log material is the
 * per-run process/chore files, and a server startup writes none of them — its
 * lines (`TM1.Server`, `TM1 Server is ready`) go to the host-side log file that
 * the REST API does not expose. Answering the run logs would fill the startup
 * view with process runs that have nothing to do with a startup. Callers gate on
 * `isStartupAnalysisAvailable` before getting here; the throw is the backstop.
 */
export async function fetchMessageLogSlice(
  config: Tm1Config,
  opts: { top: number; filter?: string; ascending?: boolean; timeoutMs?: number },
): Promise<MessageLogEntry[]> {
  if (config?.version === 'v12') {
    throw new Error(vscode.l10n.t('TM1 v12 does not expose the server log over REST — server startups cannot be analysed. Only per-run process and chore logs are available.'));
  }
  const order = opts.ascending ? 'asc' : 'desc';
  const res = await apiRequest(
    'GET',
    `MessageLogEntries?$orderby=TimeStamp ${order}&$top=${opts.top}`
      + (opts.filter ? '&$filter=' + encodeURIComponent(opts.filter) : ''),
    undefined,
    opts.timeoutMs,
    config,
  );
  assertOk(res);
  return parseBody<{ value?: MessageLogEntry[] }>(res).value ?? [];
}

/**
 * Fetch the raw content of a TM1 process error-log file.
 *
 * Primary endpoint (TM1 v11.x / PA): `ErrorLogFiles('<name>')/Content` — a
 * stream property returning the log as plain text. The `ErrorLogs('<name>')/
 * tm1.GetContent` form (JSON-wrapped) does NOT exist on stricter servers and
 * 404s with "'ErrorLogs' resource can not be resolved", so it is only tried as
 * a legacy fallback.
 */
async function fetchErrorLogContent(filename: string, config: Tm1Config): Promise<string> {
  const enc = encodeODataKey(filename);
  const direct = await apiRequest('GET', `ErrorLogFiles('${enc}')/Content`, undefined, undefined, config);
  if (isOk(direct)) {
    return direct.body; // plain-text stream
  }
  if (direct.statusCode !== 404) { assertOk(direct); }

  // Legacy fallback (JSON-wrapped action).
  const res = await apiRequest('GET', `ErrorLogs('${enc}')/tm1.GetContent`, undefined, undefined, config);
  assertOk(res);
  try {
    const json = JSON.parse(res.body);
    return json.Content ?? json.value ?? res.body;
  } catch {
    return res.body;
  }
}

// Error logs open in a virtual read-only document (own scheme) instead of an
// untitled buffer. `openTextDocument({content})` creates a dirty untitled doc,
// so closing the tab pops a "Save?" prompt — a content-provider-backed URI is
// never dirty and closes silently. The already-fetched text is stashed in the
// map keyed by URI; the provider just hands it back.
const ERRORLOG_SCHEME = 'tm1-errorlog';
const _errorLogContent = new Map<string, string>();
let _errorLogSeq = 0;
let _errorLogProviderReady = false;
let _errorLogDisposablesRegistered = false;
let _errorLogDisposables: vscode.Disposable[] = [];

function ensureErrorLogProvider(context?: vscode.ExtensionContext): void {
  if (!_errorLogProviderReady) {
    _errorLogProviderReady = true;
    _errorLogDisposables = [
      vscode.workspace.registerTextDocumentContentProvider(ERRORLOG_SCHEME, {
        provideTextDocumentContent: (uri) => _errorLogContent.get(uri.toString()) ?? '',
      }),
      // Free the cached text once the tab is gone so the map can't grow unbounded.
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.scheme === ERRORLOG_SCHEME) { _errorLogContent.delete(doc.uri.toString()); }
      }),
    ];
  }
  // context is absent when openErrorLog is invoked directly (e.g. from the
  // execute-result notification, before the Message Log panel has ever opened) —
  // the provider is still registered so the tm1-errorlog: URI resolves. Push the
  // disposables into subscriptions once a call finally supplies a context, even
  // if the provider was created earlier by a context-less call.
  if (context && !_errorLogDisposablesRegistered) {
    _errorLogDisposablesRegistered = true;
    context.subscriptions.push(..._errorLogDisposables);
  }
}

/** Open an error-log file's content in a read-only editor tab (no save prompt on close). */
export async function openErrorLog(filename: string, config: Tm1Config): Promise<void> {
  ensureErrorLogProvider();
  try {
    const content = await fetchErrorLogContent(filename, config);
    // Unique query per open: same filename can be re-fetched with fresh content,
    // and openTextDocument caches by URI — the seq busts that cache.
    const uri = vscode.Uri.from({ scheme: ERRORLOG_SCHEME, path: `/${filename}`, query: String(_errorLogSeq++) });
    _errorLogContent.set(uri.toString(), content);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, 'log');
    // ViewColumn: deliberate
    // FIXED column on purpose: the error log belongs to the left, NEXT TO the
    // message-log panel (column two, see below). `Active` would put it into
    // that panel's group and cover the log.
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: true });
  } catch (err) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Could not open error log {0}: {1}', filename, errMsg(err)),
    );
  }
}

/**
 * Window depths the panel offers. The dropdown is BUILT from this list and the
 * host clamps `setTop` to its maximum, so the two cannot drift apart again.
 */
// Measured live on 11.8 (118,904 lines in the log): 500 lines 0.12 MB, 2000
// 0.47 MB, 5000 1.16 MB, 10000 2.27 MB — all answered in around 250 ms. So
// server time does NOT depend on the depth; only the rendering gets
// expensive.
export const TOP_OPTIONS = [50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
export const MAX_TOP = Math.max(...TOP_OPTIONS);

/** Exported for the toolbar-wiring guard in `src/test/commands/messageLogToolbarWiring.test.ts`. */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, startupAvailable = true): string {
  const css = `
  html, body { height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; flex-wrap: wrap; }
  .toolbar .title { font-weight: 600; margin-right: 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); border-color: var(--vscode-toolbar-hoverOutline, transparent); }
  .toolbar button:active { background: var(--vscode-toolbar-activeBackground, rgba(128,128,128,0.28)); }
  .toolbar button.toggled { background: var(--vscode-inputOption-activeBackground); color: var(--vscode-inputOption-activeForeground); }
  .toolbar button.lvl { font-weight: 600; }
  /* Level filters: neutral toggled bg (theme-agnostic) + saturated editor severity
     foregrounds so the colored text keeps contrast in light AND dark themes.
     The chart-* tokens render pastel on light backgrounds → washed out. */
  .toolbar button.lvl.toggled { background: var(--vscode-toolbar-activeBackground, rgba(128,128,128,0.28)); }
  .toolbar button.lvl.l-info.toggled  { color: var(--vscode-editorInfo-foreground, #2196f3); }
  .toolbar button.lvl.l-warn.toggled  { color: var(--vscode-editorWarning-foreground, #bf8803); }
  .toolbar button.lvl.l-err.toggled   { color: var(--vscode-editorError-foreground, #e51400); }
  /* Analyze is the panel's primary action — accent-filled so it does not read as
     another neutral toolbar toggle. */
  .toolbar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-border, transparent); font-weight: 600; }
  .toolbar button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .toolbar button.primary:disabled { opacity: 0.5; }
  .toolbar select, .toolbar input[type="text"] {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; border-radius: 2px;
  }
  .toolbar select:focus, .toolbar input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .toolbar label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  /* Source filter: <details> instead of a hand-built popup — the open/close state
     is the element's own, no outside-click handler and no positioning code. */
  .toolbar details.dd { position: relative; font-size: 12px; }
  .toolbar details.dd > summary {
    list-style: none; cursor: pointer; padding: 3px 6px; white-space: nowrap;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px;
  }
  .toolbar details.dd > summary::-webkit-details-marker { display: none; }
  /* One arrow for both drop-down elements. A <select> is a REPLACED element and
     has no ::after, so the glyph cannot come from a pseudo-element; instead the
     select box and the <summary> draw the same SVG background, and
     appearance:none takes away the select box's own one. The rule stands AFTER
     the two blocks above: they carry background as a shorthand, which would clear
     away a background-image set earlier. */
  .toolbar select, .toolbar details.dd > summary {
    appearance: none; -webkit-appearance: none;
    padding-right: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23888888' stroke-width='1.3' d='M4 6.5 8 10.5 12 6.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 4px center; background-size: 12px 12px;
  }
  .toolbar details.dd .menu {
    position: absolute; z-index: 5; top: calc(100% + 2px); left: 0;
    min-width: 200px; max-height: 280px; overflow: auto; padding: 4px;
    background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .toolbar details.dd .menu label { display: flex; align-items: center; gap: 6px; padding: 2px 4px; font-size: 12px; color: var(--vscode-foreground); white-space: nowrap; cursor: pointer; }
  .toolbar details.dd .menu label:hover { background: var(--vscode-list-hoverBackground); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #4caf50); display: inline-block; flex-shrink: 0; }
  .dot.err { background: var(--vscode-charts-red, #f44336); }
  #status { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  /* No padding on the scroll container: with padding-top the sticky header docks
     8px below the scrollport edge and rows scroll through the gap above it.
     Horizontal insets live on the edge cells instead. */
  .content { padding: 0; overflow: auto; flex: 1 1 auto; min-height: 0; }
  table { min-width: 100%; border-collapse: collapse; font-size: 12px; }
  /* Sticky must sit on the cells, not on the row: with border-collapse the row's
     background and its collapsed borders do not travel with a stuck <tr>, so rows
     bleed through the header. Opaque toolbar background + box-shadow rule (a real
     border would be collapsed away) makes the header read as part of the chrome. */
  th {
    position: sticky; top: 0; z-index: 2;
    background: var(--vscode-sideBar-background, var(--vscode-editorGroupHeader-tabsBackground));
    padding: 5px 8px; text-align: left; font-weight: 600; white-space: nowrap;
    text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em;
    color: var(--vscode-descriptionForeground);
    box-shadow: inset 0 -1px 0 var(--vscode-panel-border, var(--vscode-editorGroup-border));
  }
  td { padding: 3px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; }
  th:first-child, td:first-child { padding-left: 12px; }
  th:last-child, td:last-child { padding-right: 12px; }
  tbody tr:first-child td { padding-top: 5px; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .l-info { color: var(--vscode-editorInfo-foreground, #2196f3); font-weight: 600; }
  .l-warn { color: var(--vscode-editorWarning-foreground, #bf8803); font-weight: 600; }
  .l-err  { color: var(--vscode-editorError-foreground, #e51400); font-weight: 600; }
  .l-dbg  { color: var(--vscode-descriptionForeground); }
  #error { color: var(--vscode-errorForeground); padding: 4px 12px 8px; font-size: 12px; flex-shrink: 0; }
  .ts { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .lg { color: var(--vscode-descriptionForeground); }
  .thr { text-align: right; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
  .errlink { color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; }
  .errlink:hover { color: var(--vscode-textLink-activeForeground); }
`;
  const body = `
<div class="toolbar">
  <span class="title"><span class="dot" id="dot"></span>TM1 Message Log</span>
  <button class="lvl l-info toggled" data-lvl="info"  title="${vscode.l10n.t('Show info entries')}">Info</button>
  <button class="lvl l-warn toggled" data-lvl="warn"  title="${vscode.l10n.t('Show warnings')}">Warn</button>
  <button class="lvl l-err  toggled" data-lvl="error" title="${vscode.l10n.t('Show errors')}">Error</button>
  <button class="lvl       toggled" data-lvl="debug" title="${vscode.l10n.t('Show debug entries')}">Debug</button>
  <label>${vscode.l10n.t('Entries')} <select id="topSel">
    ${TOP_OPTIONS.map((n) => `<option value="${n}"${n === 100 ? ' selected' : ''}>${n}</option>`).join('\n    ')}
  </select></label>
  <details class="dd" id="loggerDd">
    <summary title="${vscode.l10n.t('Filter by where an entry comes from (TM1 logger, e.g. TM1.Server, TM1.Process, TM1.Chore). All sources are shown by default.')}">${vscode.l10n.t('Source')}<span id="loggerCount"></span></summary>
    <div class="menu" id="loggerMenu"></div>
  </details>
  <input id="filterInput" type="text" placeholder="${vscode.l10n.t('Text search…')}" />
  <button id="analyzeBtn" class="primary" title="${vscode.l10n.t('Analyze process runs')}">${vscode.l10n.t('Analyze')}</button>
  <button id="startupBtn" class="primary"${startupAvailable ? '' : ' disabled'} title="${startupAvailable
    ? vscode.l10n.t('Break down a server startup')
    // Disabled rather than hidden: a missing button reads as a bug, a disabled
    // one with the reason on it answers the question before it is asked.
    : vscode.l10n.t('TM1 v12 does not expose the server log over REST — only per-run process and chore logs are available.')}">${vscode.l10n.t('Startup')}</button>
  <div class="spacer"></div>
  <span id="status">–</span>
</div>
<div id="error"></div>
<div class="content">
<table data-resizable>
  <thead><tr><th>${vscode.l10n.t('Timestamp')}</th><th>Level</th><th>${vscode.l10n.t('Source')}</th><th>${vscode.l10n.t('Thread')}</th><th>${vscode.l10n.t('Message')}</th></tr></thead>
  <tbody id="tbody"></tbody>
</table>
</div>
`;
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: css + COLUMN_RESIZE_CSS,
    body,
    scriptUris: [String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'messageLog.js')))],
    // Column width via drag (webviews/columnResize.ts) runs after the bundle.
    inlineScript: columnResizeScript('messageLog', savedColumnWidths('messageLog')),
  });
}

const panels = new Map<string, vscode.WebviewPanel>();
const timers = new Map<string, NodeJS.Timeout>();

/** Close the message-log panel for the given server, if open. */
export function disposeMessageLogPanelForServer(serverUrl: string): void {
  if (!serverUrl) { return; }
  // The v12 run-log cache is keyed by server: a disconnect must not leave a
  // reconnect reading log files this session decided were final. AFTER the guard
  // above — an empty url would clear the cache of EVERY server.
  clearV12RunLogCache(serverUrl);
  const panel = panels.get(serverUrl);
  if (panel) { panel.dispose(); }
}

registerServerDisposer('messageLogPanel', (url) => disposeMessageLogPanelForServer(url));

export async function showMessageLogCommand(context: vscode.ExtensionContext, node?: Tm1TreeNode): Promise<void> {
  const nodeServerId = node?.meta?.serverId as string | undefined;
  const serverCfg = nodeServerId ? getServerConfig(nodeServerId) : await pickDeployTarget();
  if (!serverCfg) {
    // Node path: the server for this node is gone (disconnect/stale id) — tell the
    // user. Palette path returns undefined only on picker-cancel → stay silent.
    if (nodeServerId) { vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server connected.')); }
    return;
  }

  ensureErrorLogProvider(context);

  const key = serverCfg.serverUrl;
  const existing = panels.get(key);
  if (existing) { existing.reveal(); return; }

  const serverLabel = formatServerLabel(serverCfg.serverUrl, getServerNameByUrl);
  const panel = vscode.window.createWebviewPanel(
    'tm1MessageLog',
    serverLabel ? `${serverLabel} : TM1 Message Log` : 'TM1 Message Log',
    // ViewColumn: deliberate
    // FIXED column on purpose: the log sits on the right, so an error log
    // opened from it (column one, see above) lands beside it and not on top
    // of it. Do NOT switch this to the host default `Active`.
    vscode.ViewColumn.Two,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')] }
  );
  setPanelIcon(panel, 'tm1MessageLog');
  muteWebviewOnDispose(panel);
  panels.set(key, panel);

  let currentTop = 100;
  // Mirrors the webview's four toolbar toggles. Kept host-side because the
  // depth window is applied on the SERVER now, so the panel has to know which
  // levels are wanted before it can ask for anything.
  let currentLevels: Record<string, boolean> = { info: true, warn: true, error: true, debug: true };
  let inFlight = false;
  panel.webview.html = getHtml(panel.webview, context.extensionUri, isStartupAnalysisAvailable(serverCfg.version));
  rememberColumnWidths(panel, 'messageLog');

  async function refresh() {
    if (!panels.get(key)) { return; }
    if (!serverCfg) { return; }
    // In-flight guard: the poll timer fires regardless of whether the
    // previous fetch has finished. Without the guard, against a slow or
    // dying server, up to (timeout / interval) parallel requests would pile
    // up.
    if (inFlight) { return; }
    inFlight = true;
    try {
      const levelFilter = buildLevelFilter(currentLevels);
      if (levelFilter === null) {
        // Every toggle off. `buildLevelFilter` answers null rather than an empty
        // filter string on purpose: an empty $filter would mean "everything".
        // Post the empty table instead of asking for rows nobody wants.
        postTo<MessageLogToWebview>(panel.webview, { entries: [], ts: Date.now() });
        return;
      }
      const entries = await fetchMessageLogEntries(currentTop, serverCfg, { levelFilter, levels: currentLevels });
      // Panel may have been disposed during the await (tab closed, window
      // reload). Posting to a disposed webview throws "Webview is disposed".
      if (!panels.get(key)) { return; }
      const mapped = entries.map(mapLogEntry);
      postTo<MessageLogToWebview>(panel.webview, { entries: mapped, ts: Date.now() });
    } catch (err) {
      if (!panels.get(key)) { return; }
      // No entries field: on error, the client keeps the last good table.
      // `formatTreeError` collapses a transport timeout to a translatable base
      // string (the transport itself is vscode-free and throws English), so the
      // webview shows a localized message instead of the raw REST text.
      postTo<MessageLogToWebview>(panel.webview, { error: vscode.l10n.t(formatTreeError(err)), ts: Date.now() });
    } finally {
      inFlight = false;
    }
  }

  // Captured below; disposed on panel close so listener scoped to
  // panel instead of accumulating in context.subscriptions across reopens (F4).
  const msgSub = panel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
    if (msg.command === 'setTop') {
      // Clamp: the webview value determines $top; without an upper bound, a
      // large value would pull a several-MB message-log payload on every
      // poll-loop tick. The upper bound MUST be the largest option of the
      // dropdown — a lower one would silently swallow the selection (10000
      // chosen, "5000/5000" in the corner, no hint). Hence both come from
      // TOP_OPTIONS. Measured live on 11.8: 10000 lines are 2.27 MB in 259
      // ms, the same server time as 100.
      const top = Number(msg.top);
      currentTop = Number.isFinite(top) ? Math.min(Math.max(Math.trunc(top), 1), MAX_TOP) : 100;
      void refresh();
    } else if (msg.command === 'setLevels' && msg.levels) {
      const lv: Record<string, unknown> = msg.levels;
      currentLevels = {
        info: !!lv.info, warn: !!lv.warn, error: !!lv.error, debug: !!lv.debug,
      };
      // If a poll happens to be mid-flight the guard drops this call; the next
      // tick (≤ refreshMs) fetches with the new levels anyway, since the state
      // above is already updated.
      void refresh();
    } else if (msg.command === 'openErrorLog' && msg.file) {
      void openErrorLog(String(msg.file), serverCfg);
    } else if (msg.command === 'openStartup') {
      // Same detour as `openAnalysis` below, and for the same reason: importing
      // messageLogStartup.ts here would close a cycle, since that file imports
      // `fetchMessageLogSlice` from this one.
      void vscode.commands.executeCommand('tm1.showMessageLogStartup', { cfg: serverCfg });
    } else if (msg.command === 'openAnalysis') {
      // Dispatched via the command palette entry (registerOtherCommands.ts)
      // instead of a direct module import — a direct import of
      // messageLogAnalysis.ts would form a circular dependency (it already
      // imports fetchMessageLogEntries from this file), which the
      // depcruise no-circular gate rejects.
      void vscode.commands.executeCommand('tm1.showMessageLogAnalysis', { cfg: serverCfg, initialTop: currentTop });
    }
  });

  const refreshMs = Math.max(vscode.workspace.getConfiguration('tm1').get<number>('messageLogRefreshMs') ?? 5000, 250);
  void refresh();
  timers.set(key, setInterval(() => { void refresh(); }, refreshMs));

  // P4: stop polling while the panel sits in a hidden tab — same pattern as
  // threads.ts. Resumes with a fresh fetch on tab focus.
  const viewStateSub = panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.visible) {
      if (!timers.get(key)) {
        const ms = Math.max(vscode.workspace.getConfiguration('tm1').get<number>('messageLogRefreshMs') ?? 5000, 250);
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
  }, null, context.subscriptions);
}
