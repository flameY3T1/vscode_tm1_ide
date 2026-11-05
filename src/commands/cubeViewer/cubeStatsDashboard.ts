import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import { apiRequest } from '../../tm1Rest/client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { executeMdx } from '../../mdx/executeMdx';
import { buildCubeStatsMdx, parseCubeStats, statsToCsv } from '../../cubeStats/cubeStatsApi';
import { getCubeStatsHtml } from '../../cubeStats/cubeStatsWebview';
import { parseODataValueBody } from '../../tm1Rest/parseRest';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { encodeODataKey } from '../../utils/odataKey';
import { outputChannel } from '../../utils/outputChannel';
import { isOk } from '../../tm1Rest/httpError';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import type { CubeStatsToHost, CubeStatsToWebview } from '../../webviewClient/cubeStats/protocol';
import { postTo } from '../../webviews/typedPost';

// Lazy-init: channel only created on first debug append (when cubeStats.debugLog
// is enabled). Module import stays side-effect-free — no dead channel in the
// Output dropdown for users who never turn on debug logging.
let _out: vscode.OutputChannel | undefined;
function getOut(): vscode.OutputChannel {
  if (!_out) { _out = outputChannel('TM1 RAM-Dashboard'); }
  return _out;
}

function debugLogEnabled(): boolean {
  return vscode.workspace.getConfiguration('tm1').get<boolean>('cubeStats.debugLog') === true;
}

function debugAppend(msg: string): void {
  if (debugLogEnabled()) { getOut().appendLine(msg); }
}

/** Singleton manager: one dashboard panel per server. */
export class CubeStatsDashboardManager {
  private panels: Map<string, vscode.WebviewPanel> = new Map();

  constructor(private readonly extensionUri: vscode.Uri) {
    registerServerDisposer('cubeStatsDashboard', (url) => this.disposePanelsForServer(url));
  }

  /** Close the RAM dashboard panel for the given server, if open. */
  disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    const panel = this.panels.get(serverUrl);
    if (panel) { panel.dispose(); }
  }

  /** Opens (or reveals) the RAM dashboard for `config`. */
  async open(config: Tm1Config | undefined): Promise<void> {
    if (!config) {
      vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server connected.'));
      return;
    }
    const key = config.serverUrl;
    const existing = this.panels.get(key);
    if (existing) { existing.reveal(); return; }

    const serverLabel = formatServerLabel(config.serverUrl, getServerNameByUrl) ?? config.serverUrl;

    const panel = vscode.window.createWebviewPanel(
      'tm1CubeStatsDashboard',
      `TM1 RAM-Dashboard — ${serverLabel}`,
      vscode.ViewColumn.Active,
      // Read-only dashboard; re-hydrates fully on the client's `ready` message
      // (cubeStatsWebview.ts) so destroying on hide is safe and frees DOM.
      {
        enableScripts: true, retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out')],
      },
    );
    setPanelIcon(panel, 'tm1CubeStatsDashboard');
    muteWebviewOnDispose(panel);
    this.panels.set(key, panel);

    panel.webview.html = getCubeStatsHtml(serverLabel, panel.webview.cspSource, String(
      panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'cubeStats.js'))));

    panel.onDidDispose(() => {
      this.panels.delete(key);
    });

    panel.webview.onDidReceiveMessage(async (msg: CubeStatsToHost) => {
      if (!msg?.type) { return; }
      switch (msg.type) {
        case 'ready':
        case 'refresh':
          await this._loadStats(panel, config);
          break;
        case 'exportCsv':
          await this._exportCsv(msg.stats);
          break;
      }
    });
  }

  /** Reads the dim names of `}StatsByCube`, builds matching MDX, parses the cellset. */
  private async _loadStats(panel: vscode.WebviewPanel, config: Tm1Config): Promise<void> {
    postTo<CubeStatsToWebview>(panel.webview, { type: 'loading', value: true });
    getOut().appendLine(`[${new Date().toISOString()}] Loading cube stats from ${config.serverUrl}`);
    try {
      // 1) Discover all dims of }StatsByCube.
      const cubeRes = await apiRequest(
        'GET',
        `Cubes('%7DStatsByCube')?$select=Name&$expand=Dimensions($select=Name)`,
        undefined, undefined, config,
      );
      if (cubeRes.statusCode === 404) {
        postTo<CubeStatsToWebview>(panel.webview, { type: 'error', message: vscode.l10n.t('}StatsByCube not found. Server version probably does not support cube stats.') });
        return;
      }
      if (!isOk(cubeRes)) {
        getOut().appendLine(`Cube-Discovery HTTP ${cubeRes.statusCode}: ${cubeRes.body}`);
        postTo<CubeStatsToWebview>(panel.webview, { type: 'error', message: vscode.l10n.t('Cube discovery failed (HTTP {0}). See the output channel for details.', String(cubeRes.statusCode)) });
        return;
      }
      const cubeJson = JSON.parse(cubeRes.body);
      const dims: string[] = ((cubeJson.Dimensions ?? []) as Array<{ Name: string }>).map(d => d.Name);
      debugAppend(`Cube dims: ${dims.join(', ')}`);

      // 2) Classify ALL dims by sampling their elements.
      //    measuresDim = contains "Total Memory Used"
      //    intervalDim = contains "Latest"
      //    cubesDim    = the remaining dim (}Cubes / }PerfCubes / …)
      let measuresDim: string | undefined;
      let intervalDim: string | undefined;
      let cubesDim: string | undefined;
      let latestElement: string | undefined; // actual casing from server
      for (const d of dims) {
        const elemRes = await apiRequest(
          'GET',
          `Dimensions('${encodeODataKey(d)}')/Hierarchies('${encodeODataKey(d)}')/Elements?$select=Name&$top=200`,
          undefined, undefined, config,
        );
        if (!isOk(elemRes)) {
          getOut().appendLine(`Elements fetch ${d} HTTP ${elemRes.statusCode}`);
          continue;
        }
        const names: string[] = parseODataValueBody<{ Name: string }>(elemRes).map((e) => String(e.Name));
        debugAppend(`Dim '${d}' (${names.length} elements): ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}`);
        const hasTotalMem = names.some(n => n.toLowerCase() === 'total memory used');
        const latest = names.find(n => n.toLowerCase() === 'latest');
        if (!measuresDim && hasTotalMem) { measuresDim = d; continue; }
        if (!intervalDim && latest) { intervalDim = d; latestElement = latest; continue; }
        if (!cubesDim) { cubesDim = d; }
      }

      if (!measuresDim) {
        postTo<CubeStatsToWebview>(panel.webview, { type: 'error', message: vscode.l10n.t('Cannot identify the measures dimension in }StatsByCube (no "Total Memory Used" element).') });
        return;
      }
      if (!cubesDim) {
        // Fallback: any dim not yet assigned, prefer one that looks like a cubes dim.
        cubesDim = dims.find(n => n !== measuresDim && n !== intervalDim);
      }
      if (!cubesDim) {
        postTo<CubeStatsToWebview>(panel.webview, { type: 'error', message: vscode.l10n.t('Cannot identify the cubes dimension in }StatsByCube.') });
        return;
      }
      debugAppend(`measuresDim=${measuresDim}  cubesDim=${cubesDim}  intervalDim=${intervalDim ?? '(none)'}  latestElem=${latestElement ?? '(n/a)'}`);

      // 3) Run MDX with discovered dims, slicing on Latest if available.
      const api = (method: string, path: string, body?: string) => apiRequest(method, path, body, undefined, config);
      const mdx = buildCubeStatsMdx(
        measuresDim,
        cubesDim,
        intervalDim && latestElement ? { dim: intervalDim, element: latestElement } : undefined,
      );
      debugAppend(`MDX: ${mdx}`);
      const result = await executeMdx(mdx, api);
      if (!result.ok) {
        const errMsg = result.needsConfirm
          ? vscode.l10n.t('Cellset > 50k cells ({0}) — check server configuration.', String(result.cellCount))
          : vscode.l10n.t('MDX failed: {0}', result.error.message);
        getOut().appendLine(`Result error: ${errMsg}`);
        postTo<CubeStatsToWebview>(panel.webview, { type: 'error', message: errMsg });
        return;
      }
      const stats = parseCubeStats(result.table);
      getOut().appendLine(`Parsed ${stats.length} cubes`);
      postTo<CubeStatsToWebview>(panel.webview, { type: 'data', stats });
    } catch (err) {
      const e = err as { stack?: string; message?: string };
      getOut().appendLine(`Exception: ${e.stack ?? e.message ?? err}`);
      postTo<CubeStatsToWebview>(panel.webview, { type: 'error', message: vscode.l10n.t('Loading failed: {0}', String(e.message ?? err)) });
    } finally {
      postTo<CubeStatsToWebview>(panel.webview, { type: 'loading', value: false });
    }
  }

  private async _exportCsv(stats: any): Promise<void> {
    if (!Array.isArray(stats) || stats.length === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('TM1: No data to export.'));
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('cube-stats.csv'),
      filters: { CSV: ['csv'] },
    });
    if (!uri) { return; }
    const csv = statsToCsv(stats);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
    vscode.window.showInformationMessage(vscode.l10n.t('TM1: CSV saved ({0} rows).', stats.length));
  }
}
