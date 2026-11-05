import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { getOrBuildIndex, invalidateReferenceIndex } from './referenceIndexService';
import { buildDependencyGraph, buildCubeFlow } from './lineagePure';
import type { LineageBootstrap } from '../webviewClient/lineage/protocol';
import { renderWebviewShell } from '../webviews/webviewShell';
import { errMsg } from '../utils/errMsg';
import { escapeHtml } from '../utils/escapeHtml';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview } from '../webviewClient/lineage/protocol';

/**
 * "Lineage" — two views of one server's model as a layered graph:
 *  - Dependencies: chores, processes, cubes, dimensions around one object
 *    (calls plus data access, see `focusGraph`);
 *  - Data flow: cubes only, linked by processes and rules (see `buildCubeFlow`).
 *
 * Two homes: the "Lineage" tab of the usage/call graph panel (focused on that
 * panel's object) and its own panel from the server's context menu, which opens
 * on the data flow of the whole server — the overview.
 */
const host = new WebviewPanelHost<{ type?: string; id?: string; name?: string }>('tm1.lineage', 'Lineage');

export function disposeLineagePanelsForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

registerServerDisposer('lineage', (url) => disposeLineagePanelsForServer(url));

/**
 * Open (or bring forward) the server's own lineage panel. `highlightId` marks
 * the object the user came from — a cube directly, a process or chore through
 * the cubes of its chain — without making it the center.
 */
export function openLineageOverview(
  extensionUri: vscode.Uri,
  cfg: Tm1Config,
  serverId: string,
  serverLabel: string,
  includeSystem: boolean,
  highlightId?: string,
): void {
  const existing = host.get(`${cfg.serverUrl}::lineage${includeSystem ? '::sys' : ''}`);
  if (existing) {
    existing.reveal();
    if (highlightId) { void postTo<HostToWebview>(existing.webview, { type: 'lineageHighlight', id: highlightId }); }
    return;
  }
  host.initialize(extensionUri);
  host.open({
    key: `${cfg.serverUrl}::lineage${includeSystem ? '::sys' : ''}`,
    title: vscode.l10n.t('Lineage — {0}', serverLabel),
    html: (webview, uri) => getLineageHtml(webview, uri, { highlightId }),
    onMessage: (msg, panel) => handleLineageMessage(msg, panel, cfg, serverId, includeSystem),
  });
}

/**
 * The map's side of the conversation. Returns false for messages that are not
 * the map's, so a host panel that shares the channel can route the rest.
 */
export async function handleLineageMessage(
  msg: { type?: string; id?: string; name?: string },
  panel: vscode.WebviewPanel,
  cfg: Tm1Config,
  serverId: string | undefined,
  includeSystem: boolean,
): Promise<boolean> {
  if (msg.type === 'mapReady' || msg.type === 'mapRefresh') {
    try {
      if (msg.type === 'mapRefresh') { invalidateReferenceIndex(cfg); }
      // getOrBuildIndex shows its own progress notification while building.
      const idx = await getOrBuildIndex(cfg);
      void postTo<HostToWebview>(panel.webview, { type: 'mapData', graph: buildDependencyGraph(idx, includeSystem), cubeGraph: buildCubeFlow(idx, includeSystem) });
    } catch (err) {
      void postTo<HostToWebview>(panel.webview, { type: 'mapError', message: vscode.l10n.t('TM1 reference analysis failed: {0}', errMsg(err)) });
    }
    return true;
  }
  if (msg.type === 'lineageServer') {
    // From an object's tab: the whole server lives in the server's own panel —
    // one per server, titled for the server, not inside the object's panel.
    // Carries includeSystem along: a tab opened with control objects (Bulk
    // Delete) would otherwise hand over to a server map that hides them.
    await vscode.commands.executeCommand('tm1.showLineage', { meta: { serverId, highlightId: msg.id, includeSystem } });
    return true;
  }
  if (msg.type === 'mapOpen' && typeof msg.id === 'string' && typeof msg.name === 'string') {
    const kind = msg.id.split(':')[0];
    const [command, field] =
      kind === 'chore' ? ['tm1.editChore', 'choreName']
        : kind === 'cube' ? ['tm1.openCubeRules', 'cubeName']
          : kind === 'dimension' ? ['tm1.browseElements', 'dimName']
            : ['tm1.openProcessEditor', 'processName'];
    await vscode.commands.executeCommand(command, { meta: { serverId, [field]: msg.name } });
    return true;
  }
  return false;
}

export interface LineageHtmlOptions {
  /** Node id to focus on, e.g. `process:load_sales` (lower-case name). None = overview. */
  focusId?: string;
  /** Display name of that node — shown alone when the object has no edges at all. */
  focusName?: string;
  /** Label of the tab that leads back to the host panel's own view; no tab when absent. */
  backLabel?: string;
  /** Overview only: object to mark on first draw (not the center). */
  highlightId?: string;
}

export function getLineageHtml(webview: vscode.Webview, extensionUri: vscode.Uri, opts: LineageHtmlOptions): string {
  const L = {
    // Same word as the tab that opens this page — one name for one thing.
    title: vscode.l10n.t('Lineage'),
    dependencies: vscode.l10n.t('Dependencies'),
    dataFlow: vscode.l10n.t('Data flow'),
    overview: vscode.l10n.t('Whole server'),
    depNeedsFocus: vscode.l10n.t('Double-click a cube first — dependencies are shown around one object.'),
    hintOverview: vscode.l10n.t('Data flow between all cubes of the server: a process reads one and writes the other, or a rule or feeder connects them. Click a cube to highlight its chain, double-click makes it the center, Ctrl+click opens its rules.'),
    sources: vscode.l10n.t('External sources'),
    // Own key, not the shared 'None': that one is masculine in es/fr/it/pt-br, sources are not.
    srcOff: vscode.l10n.t('Off'),
    srcSys: vscode.l10n.t('Systems'),
    srcDetail: vscode.l10n.t('Individual'),
    srcSysTip: vscode.l10n.t('One box per folder or ODBC connection'),
    srcDetailTip: vscode.l10n.t('One box per file pattern or database table'),
    sourcesTip: vscode.l10n.t('ODBC connections and file folders that processes load into cubes'),
    noFlowAtAll: vscode.l10n.t('No data flow between cubes found on this server.'),
    viaProcess: vscode.l10n.t('via process'),
    viaRule: vscode.l10n.t('via rule / feeder'),
    via: vscode.l10n.t('via'),
    rule: vscode.l10n.t('rule / feeder'),
    hintCube: vscode.l10n.t('Cubes linked by data flow: a process reads one and writes the other, or a rule or feeder connects them. Hover a line to see what carries it. Click a cube to highlight its chain, double-click makes it the center, Ctrl+click opens its rules.'),
    noCubeFlow: vscode.l10n.t('No data flow between cubes found for this object.'),
    refresh: vscode.l10n.t('Refresh'),
    loading: vscode.l10n.t('Analyzing references…'),
    chores: vscode.l10n.t('Chores'),
    processes: vscode.l10n.t('Processes'),
    cubes: vscode.l10n.t('Cubes'),
    dimensions: vscode.l10n.t('Dimensions'),
    calls: vscode.l10n.t('calls'),
    reads: vscode.l10n.t('reads'),
    writes: vscode.l10n.t('writes'),
    hint: vscode.l10n.t('Click an object to highlight its chain: what it calls, what calls it, and the cubes they read and write. Double-click makes it the center of the map, Ctrl+click opens it. Rule references (DB) are not shown.'),
    empty: vscode.l10n.t('No calls or cube accesses found.'),
  };
  const css = `
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; }
  /* Same header as the usage / call graph / chore pages this tab sits next to,
     so switching between them does not make the page jump. */
  .bar { position: sticky; top: 0; z-index: 10; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 12px; }
  .content { padding: 8px 16px 16px 16px; }
  .bar .title { font-weight: 600; font-size: 13px; margin-right: 8px; }
  [hidden] { display: none !important; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .bar .spacer { flex: 1; }
  button { padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; border-radius: 3px; font-size: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .tab { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; border-bottom: 2px solid transparent; padding: 4px 12px; border-radius: 4px 4px 0 0; font-size: 12px; }
  .tab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .tab.active { border-bottom-color: var(--vscode-focusBorder); font-weight: 600; cursor: default; }
  .tab.active:hover { background: transparent; }
  .node.source rect { fill: var(--vscode-editor-background); stroke: var(--vscode-charts-foreground, #ccc); stroke-dasharray: 4 2; }
  .node.dimension rect { fill: var(--vscode-editor-background); stroke: var(--vscode-charts-yellow, #cca700); }
  .crumb { color: var(--vscode-descriptionForeground); }
  .legend { display: flex; gap: 14px; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .legend i { display: inline-block; width: 18px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 4px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 6px 0 10px; }
  .msg { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }
  .err { padding: 10px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 3px; }
  #wrap { overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 3px; max-height: calc(100vh - 110px); }
  svg { display: block; }
  .node rect { stroke-width: 1px; rx: 4; ry: 4; cursor: pointer; }
  .node text { font-size: 12px; fill: var(--vscode-foreground); pointer-events: none; }
  .node.chore rect { fill: var(--vscode-editor-background); stroke: var(--vscode-charts-purple, #b180d7); }
  .node.process rect { fill: var(--vscode-editor-background); stroke: var(--vscode-charts-blue, #3794ff); }
  .node.cube rect { fill: var(--vscode-editor-background); stroke: var(--vscode-charts-green, #89d185); }
  .node.focus rect { stroke-width: 3px; }
  .node:hover rect { fill: var(--vscode-list-hoverBackground); }
  .node, .edge { transition: opacity 0.12s; }
  svg.hl .node:not(.on), svg.hl .edge:not(.on) { opacity: 0.2; }
  .node.picked rect { stroke-width: 2.5px; stroke-dasharray: 3 2; }
  .edge { fill: none; stroke-width: 1.4px; opacity: 0.75; }
  .edge.calls { stroke: var(--vscode-descriptionForeground); }
  .edge.reads { stroke: var(--vscode-charts-green, #89d185); stroke-dasharray: 5 3; }
  .edge.writes { stroke: var(--vscode-charts-orange, #d18616); }
  .edge.flow { stroke: var(--vscode-charts-orange, #d18616); pointer-events: stroke; }
  .edge.rule { stroke: var(--vscode-charts-purple, #b180d7); stroke-dasharray: 5 3; pointer-events: stroke; }
  .seg { display: inline-flex; }
  .seg button { border-radius: 0; }
  .seg button:first-child { border-radius: 3px 0 0 3px; }
  .seg button:last-child { border-radius: 0 3px 3px 0; }
  button:disabled { opacity: 0.5; cursor: default; }
  .seg button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .colhead { font-size: 11px; fill: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }
  `;
  const body = `
<div class="bar">
  ${opts.backLabel ? `<button id="back" class="tab">${escapeHtml(opts.backLabel)}</button><button class="tab active">${L.title}</button>` : `<span class="title">${L.title}</span>`}
  <span class="seg"><button id="mode-obj" class="on">${L.dependencies}</button><button id="mode-cube">${L.dataFlow}</button></span>
  <span id="src-toggle" title="${L.sourcesTip}">${L.sources}: <span class="seg"><button data-src="off">${L.srcOff}</button><button data-src="sys" title="${L.srcSysTip}">${L.srcSys}</button><button data-src="detail" title="${L.srcDetailTip}">${L.srcDetail}</button></span></span>
  <button id="overview" hidden>${L.overview}</button>
  <span id="crumb" class="crumb"></span>
  <span class="spacer"></span>
  <span class="legend" id="legend-cube" hidden><span><i style="border-color:var(--vscode-charts-orange,#d18616)"></i>${L.viaProcess}</span><span><i style="border-color:var(--vscode-charts-purple,#b180d7);border-top-style:dashed"></i>${L.viaRule}</span></span>
  <span class="legend" id="legend-obj"><span><i style="border-color:var(--vscode-descriptionForeground)"></i>${L.calls}</span><span><i style="border-color:var(--vscode-charts-green,#89d185);border-top-style:dashed"></i>${L.reads}</span><span><i style="border-color:var(--vscode-charts-orange,#d18616)"></i>${L.writes}</span></span>
  <button id="refresh" class="primary">⟳ ${L.refresh}</button>
</div>
<div class="content">
<div class="hint" id="hint">${L.hint}</div>
<div id="status" class="msg">${L.loading}</div>
<div id="wrap" hidden></div>
</div>
`;
  return renderWebviewShell({
    cspSource: webview.cspSource, css, body,
    globals: {
      __lineage: {
        texts: L,
        initialFocus: opts.focusId ?? null,
        initialName: opts.focusName ?? '',
        inTab: !!opts.backLabel,
        highlightId: opts.highlightId ?? null,
      } satisfies LineageBootstrap,
    },
    scriptUris: [String(webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'lineage.js')))],
  });
}
