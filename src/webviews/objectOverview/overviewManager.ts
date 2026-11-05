// src/webviews/objectOverview/overviewManager.ts
import { setPanelIcon } from '../panelIcons';
import { muteWebviewOnDispose } from '../webviewPanelHost';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getOverviewHtml } from './overviewShell';
import { rememberColumnWidths } from '../columnWidthStore';
import { buildOverviewL10n } from './overviewL10n';
import { errMsg } from '../../utils/errMsg';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { formatServerLabel, getServerNameByUrl } from '../../serverState/state';
import type { ColumnDef, KpiDef, OverviewRow, KpiValue } from './overviewTypes';
import type { HostToOverview, OverviewToHost } from './overviewProtocol';
import { postTo } from '../typedPost';

/** Static per-type configuration for one overview page. */
export interface OverviewConfig {
  viewType: string;
  title: string;
  controlNoun: string;
  columns: ColumnDef[];
  kpis: KpiDef[];
  /** One cheap call → rows + base KPIs. Throws on failure (shown as error box). */
  baseFetch: (cfg: Tm1Config) => Promise<{ rows: OverviewRow[]; kpis: KpiValue[] }>;
  /** Optional expensive metrics; call `emit` with `patch`/`kpi` messages as they resolve. */
  lazyFetch?: (cfg: Tm1Config, rows: OverviewRow[], emit: (m: HostToOverview) => void) => Promise<void>;
  /** Open the editor for a clicked row (object name = id). */
  openEditor: (cfg: Tm1Config, id: string) => void;
}

/** Per-server singleton panel manager, generic over an OverviewConfig. */
/** Column and KPI labels are English keys in the configs; translate them in the
 *  one place every message passes, so no config (or lazy `emit`) can forget it. */
function localizeLabels(m: HostToOverview): HostToOverview {
  const tr = <T extends { label: string }>(xs: T[]): T[] => xs.map(x => ({ ...x, label: vscode.l10n.t(x.label) }));
  if (m.type === 'init') { return { ...m, columns: tr(m.columns), kpis: tr(m.kpis) }; }
  if (m.type === 'rows' || m.type === 'kpi') { return { ...m, kpis: tr(m.kpis) }; }
  return m;
}

export class OverviewPanelManager {
  private _extensionUri: vscode.Uri | undefined;
  private readonly _panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly _config: OverviewConfig) {
    registerServerDisposer(_config.viewType, (url) => this.disposePanelsForServer(url));
  }

  initialize(extensionUri: vscode.Uri): void { this._extensionUri = extensionUri; }

  open(cfg: Tm1Config): void {
    if (!this._extensionUri) {
      vscode.window.showErrorMessage(vscode.l10n.t('Overview: extension not activated yet.'));
      return;
    }
    const key = cfg.serverUrl ?? '__default__';
    const existing = this._panels.get(key);
    if (existing) { existing.reveal(); return; }

    const panel = vscode.window.createWebviewPanel(
      this._config.viewType,
      this._config.title,
      // Symbolic column: opens in the active group and thus in the same
      // window as the triggering click.
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // Read-only category overview; re-hydrates fully on the client's `ready`
        // message (objectOverview/index.ts → _load) so destroy-on-hide is safe.
        retainContextWhenHidden: false,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
          vscode.Uri.joinPath(this._extensionUri, 'media'),
        ],
      },
    );
    setPanelIcon(panel, this._config.viewType);
    muteWebviewOnDispose(panel);
    this._panels.set(key, panel);
    panel.webview.html = getOverviewHtml(panel.webview, this._extensionUri, {
      title: this._config.title,
      serverLabel: formatServerLabel(cfg.serverUrl, getServerNameByUrl) ?? cfg.serverUrl ?? '',
      // Own widths per category: cubes and processes have different columns.
      widthKind: this._config.viewType,
    });
    rememberColumnWidths(panel, this._config.viewType);
    const post = (m: HostToOverview) => { void postTo<HostToOverview>(panel.webview, localizeLabels(m)); };
    let alive = true;
    panel.onDidDispose(() => { alive = false; this._panels.delete(key); });
    panel.webview.onDidReceiveMessage((msg: OverviewToHost) => {
      if (msg.type === 'ready' || msg.type === 'refresh') { void this._load(cfg, post, () => alive); }
      else if (msg.type === 'openRow') { this._config.openEditor(cfg, msg.id); }
    });
  }

  private async _load(cfg: Tm1Config, post: (m: HostToOverview) => void, alive: () => boolean): Promise<void> {
    post({ type: 'init', columns: this._config.columns, kpis: this._config.kpis, i18n: buildOverviewL10n(), controlNoun: this._config.controlNoun });
    post({ type: 'loading', on: true });
    try {
      const { rows, kpis } = await this._config.baseFetch(cfg);
      if (!alive()) { return; }
      post({ type: 'rows', rows, kpis });
      if (this._config.lazyFetch) {
        await this._config.lazyFetch(cfg, rows, (m) => { if (alive()) { post(m); } });
      }
    } catch (err) {
      if (alive()) { post({ type: 'error', message: errMsg(err) }); }
    } finally {
      if (alive()) { post({ type: 'loading', on: false }); }
    }
  }

  disposePanelsForServer(url: string): void {
    const p = this._panels.get(url);
    if (p) { p.dispose(); }
  }
  disposeAll(): void {
    for (const p of this._panels.values()) { p.dispose(); }
    this._panels.clear();
  }
}
