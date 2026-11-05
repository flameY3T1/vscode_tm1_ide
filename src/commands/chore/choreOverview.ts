import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { listChores } from '../../tm1Rest/choreApi';
import { fetchChoreRunStats } from '../../tm1Rest/runStatsApi';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { getChoreOverviewHtml } from './choreOverviewWebview';
import type { HostToWebview as ChoreOverviewToWebview, WebviewToHost as ChoreOverviewToHost } from '../../webviewClient/choreOverview/protocol';
import { rememberColumnWidths } from '../../webviews/columnWidthStore';
import { buildOverviewRows } from './choreOverviewPure';
import { formatEpochMinute } from '../../tm1Rest/runStats';
import { errMsg } from '../../utils/errMsg';
import { postTo } from '../../webviews/typedPost';

/**
 * Singleton manager: one Chore Overview panel per server. Lists all chores with
 * their schedule (start time, frequency, execution mode). Row click opens the
 * chore in the editor via the injected `openEditor` callback.
 */
export class ChoreOverviewManager {
  private panels: Map<string, vscode.WebviewPanel> = new Map();

  constructor(
    private readonly openEditor: (name: string, cfg: Tm1Config | undefined) => void,
    private readonly extensionUri: vscode.Uri,
  ) {}

  disposeAll(): void {
    for (const p of this.panels.values()) { p.dispose(); }
    this.panels.clear();
  }

  /** Close the overview panel for one server (on disconnect). Keys are the serverUrl. */
  disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    this.panels.get(serverUrl)?.dispose();
    this.panels.delete(serverUrl);
  }

  async open(config: Tm1Config | undefined): Promise<void> {
    if (!config) {
      vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server connected.'));
      return;
    }
    const key = config.serverUrl;
    const existing = this.panels.get(key);
    if (existing) { existing.reveal(); await this._load(existing, config); return; }

    const serverLabel = formatServerLabel(config.serverUrl, getServerNameByUrl) ?? config.serverUrl;
    const panel = vscode.window.createWebviewPanel(
      'tm1ChoreOverview',
      vscode.l10n.t('Chore Overview — {0}', serverLabel),
      vscode.ViewColumn.Active,
      // Read-only overview; re-hydrates fully on the client's `ready` message
      // (choreOverviewWebview.ts) so destroying on hide is safe and frees DOM.
      {
        enableScripts: true, retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out')],
      },
    );
    setPanelIcon(panel, 'tm1ChoreOverview');
    muteWebviewOnDispose(panel);
    this.panels.set(key, panel);
    panel.webview.html = getChoreOverviewHtml(serverLabel, panel.webview.cspSource, String(
      panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'choreOverview.js'))));

    panel.onDidDispose(() => { this.panels.delete(key); });
    rememberColumnWidths(panel, 'choreOverview');

    panel.webview.onDidReceiveMessage(async (msg: ChoreOverviewToHost) => {
      if (!msg?.type) { return; }
      switch (msg.type) {
        case 'ready':
        case 'refresh':
          await this._load(panel, config);
          break;
        case 'openChore':
          if (typeof msg.name === 'string' && msg.name) { this.openEditor(msg.name, config); }
          break;
      }
    });
  }

  private async _load(panel: vscode.WebviewPanel, config: Tm1Config): Promise<void> {
    postTo<ChoreOverviewToWebview>(panel.webview, { type: 'loading', value: true });
    try {
      // The last-run facts come out of the message log (the `}StatsByChore`
      // cube stays empty — see runStats.ts). It degrades to an empty map, so a
      // server that rejects the query must not fail the whole load.
      const [chores, run] = await Promise.all([
        listChores(config, 'Name,Active,StartTime,Frequency,ExecutionMode'),
        fetchChoreRunStats(config),
      ]);
      const rows = buildOverviewRows(chores, {
        stats: run.stats,
        stateLabels: { finished: vscode.l10n.t('finished'), running: vscode.l10n.t('running') },
      });
      rows.sort((a, b) => a.name.localeCompare(b.name));
      // Runs as [start, end|null] pairs keyed by chore — the calendar draws them.
      const runs: Record<string, Array<[number, number | null]>> = {};
      for (const r of run.runs ?? []) { (runs[r.name] ??= []).push([r.startMs, r.endMs ?? null]); }
      postTo<ChoreOverviewToWebview>(panel.webview, { type: 'data', rows, runs, logReach: formatLogReach(run), now: Date.now() });
    } catch (err) {
      postTo<ChoreOverviewToWebview>(panel.webview, {
        type: 'error',
        message: vscode.l10n.t('Could not load chores: {0}', errMsg(err)),
      });
    } finally {
      postTo<ChoreOverviewToWebview>(panel.webview, { type: 'loading', value: false });
    }
  }
}

/**
 * Sentence for the "Last run" tooltip naming how far back the message log was
 * read. Empty when the log gave nothing — the tooltip then drops that half.
 */
function formatLogReach(run: {
  oldestEntry?: string; linesRead?: number; linesMatched?: number;
  reason?: 'unsupported' | 'failed';
}): string {
  // The reason first: "—" without an explanation is a display no one can
  // interpret. On v12 there is no message log, and without it no run times.
  if (run.reason === 'unsupported') {
    return vscode.l10n.t('This server has no message log, so last-run times are unavailable.');
  }
  if (run.reason === 'failed') {
    return vscode.l10n.t('The message log could not be read, so last-run times are missing.');
  }
  const ms = run.oldestEntry ? Date.parse(run.oldestEntry) : NaN;
  if (!Number.isFinite(ms)) { return ''; }
  const readBack = vscode.l10n.t('Read back to {0}.', formatEpochMinute(ms / 1000));
  // Read, but nothing recognised: without this addition, every chore shows
  // "—" and the tooltip nonetheless claims to have read up to a date. The
  // user had no clue what was causing it.
  if ((run.linesRead ?? 0) > 0 && run.linesMatched === 0) {
    return `${readBack} ${vscode.l10n.t(
      '{0} lines read, none recognised as chore runs.', String(run.linesRead))}`;
  }
  return readBack;
}
