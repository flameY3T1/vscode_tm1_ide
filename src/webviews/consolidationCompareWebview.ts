import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { DimensionApi, apiFetch, listElementNamesAndLeaves, listHierarchyNames, listWeightedEdges } from '../tm1Rest/dimensionApi';
import { applyDraft } from '../consolidationCompare/applyDraft';
import { netOps } from '../consolidationCompare/comparePure';
import { fetchAliasValues, fetchAttrDefs, fetchAttributeValues } from '../tm1Rest/dimensionElementsApi';
import { loadView, saveView } from '../commands/consolidationCompare/viewStore';
import type { KeyedMemento } from '../utils/keyedStore';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { CONSOLIDATION_COMPARE_CSS, consolidationCompareBody } from './consolidationCompareBody';
import { buildConsolidationCompareL10n } from './consolidationCompareL10n';
import type { ToClient, ToHost } from '../consolidationCompare/protocol';
import { errMsg } from '../utils/errMsg';
import { getServerConfig } from '../serverState/state';
import { pickServerLabel, pickTargetServer } from '../commands/deploy/pickTarget';
import { postTo } from './typedPost';

interface Target {
  cfg: Tm1Config; serverId: string; dim: string; hier: string;
  /** Counts edge loads; only the answer to the latest one is shown. */
  loads: number;
}

const titleFor = (dim: string, hier: string): string =>
  vscode.l10n.t('Compare Consolidations: {0}', dim === hier ? dim : `${dim}:${hier}`);

export class ConsolidationComparePanel {
  private static host: WebviewPanelHost<ToHost>;
  /** Latest target per panel key; `onMessage` is wired once, so it reads from here. */
  private static readonly targetByKey = new Map<string, Target>();
  private static memento: KeyedMemento;

  static initialize(extensionUri: vscode.Uri, memento: KeyedMemento): void {
    this.memento = memento;
    this.host = new WebviewPanelHost<ToHost>('tm1.consolidationCompare', 'Compare Consolidations');
    this.host.initialize(extensionUri);
  }

  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cfg: Tm1Config, serverId: string, dim: string, hier: string): void {
    if (!this.host) {
      throw new Error('ConsolidationComparePanel not initialized');
    }
    // One panel per dimension; `::` separates the server part, so
    // disposePanelsForServer finds the panel. The hierarchy is switched inside.
    const key = `${cfg.serverUrl}::cc#${dim}`;
    // A reopen only reveals the panel — keep the hierarchy it shows.
    const shown = this.targetByKey.get(key);
    this.targetByKey.set(key, { cfg, serverId, dim, hier: shown?.hier ?? hier, loads: shown?.loads ?? 0 });

    this.host.open({
      key,
      title: titleFor(dim, shown?.hier ?? hier),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) => {
        const scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'consolidationCompare.js'),
        );
        const l10n = buildConsolidationCompareL10n();
        return renderWebviewShell({
          cspSource: webview.cspSource,
          css: CONSOLIDATION_COMPARE_CSS,
          body: consolidationCompareBody(l10n),
          globals: { __l10n: l10n },
          scriptUris: [String(scriptUri)],
        });
      },
      onMessage: (msg: ToHost, panel: vscode.WebviewPanel) => {
        const target = ConsolidationComparePanel.targetByKey.get(key);
        return target ? ConsolidationComparePanel.onMessage(msg, panel, target) : undefined;
      },
      onDispose: () => {
        ConsolidationComparePanel.targetByKey.delete(key);
      },
    });
  }

  private static async onMessage(msg: ToHost, panel: vscode.WebviewPanel, t: Target): Promise<void> {
    const post = (m: ToClient): void => { void postTo<ToClient>(panel.webview, m); };
    if (msg.type === 'ready' || msg.type === 'reload' || msg.type === 'switchHierarchy') {
      // A switch takes effect only once its hierarchy has loaded; until then
      // everything else still targets the hierarchy the client shows.
      const switching = msg.type === 'switchHierarchy';
      const hier = switching ? msg.hier : t.hier;
      const load = ++t.loads;
      const stale = (): boolean => t.loads !== load;
      post({ type: 'loading' });
      try {
        const [edges, defs, { names: elements, leaves }, hiers] = await Promise.all([
          listWeightedEdges(t.cfg, t.dim, hier),
          fetchAttrDefs(t.dim, hier, t.cfg),
          listElementNamesAndLeaves(t.cfg, t.dim, hier),
          listHierarchyNames(t.cfg, t.dim),
        ]);
        if (stale()) { return; }
        t.hier = hier;
        panel.title = titleFor(t.dim, t.hier);
        const aliases = defs.filter(d => d.Type === 'Alias').map(d => d.Name);
        // `Leaves` has no consolidations.
        const hierarchies = hiers.filter(h => h.toLowerCase() !== 'leaves');
        // Scope attributes: aliases are unique per element, so they cannot group anything.
        const attributes = defs.filter(d => d.Type !== 'Alias').map(d => d.Name);
        const view = loadView(ConsolidationComparePanel.memento, t.serverId, t.dim, hier);
        post({ type: 'edges', dim: t.dim, hier, edges, aliases, elements, hierarchies, leaves, attributes, view });
      } catch (e) {
        if (!stale()) { post({ type: 'error', message: errMsg(e), switchFailed: switching || undefined }); }
      }
      return;
    }
    // Reads are labelled with the hierarchy they were made for; a switch while
    // they run makes them stale, and a stale answer is dropped, not shown.
    const hier = t.hier;
    const stale = (): boolean => t.hier !== hier;
    if (msg.type === 'save') {
      const ops = netOps(msg.base, msg.changes);
      const n = ops.remove.length + ops.patch.length + ops.add.length;
      if (!n) { post({ type: 'saveCancelled' }); return; }
      const where = t.dim === t.hier ? t.dim : `${t.dim}:${t.hier}`;
      const yes = vscode.l10n.t('Write');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Write {0} edge changes to {1}? This writes to TM1.', String(n), where),
        { modal: true, detail: vscode.l10n.t('{0} removed, {1} reweighted, {2} added.', String(ops.remove.length), String(ops.patch.length), String(ops.add.length)) },
        yes,
      );
      if (choice !== yes) { post({ type: 'saveCancelled' }); return; }
      const api = new DimensionApi(apiFetch, { dimName: t.dim, config: t.cfg });
      try {
        const r = await applyDraft(api, () => listWeightedEdges(t.cfg, t.dim, t.hier), t.hier, msg.base, msg.changes);
        if (r.ok) { post({ type: 'saved', edges: r.edges }); return; }
        post({ type: 'saveFailed', conflict: r.conflict, message: r.conflict ? '' : r.message, edges: r.edges });
      } catch (e) {
        // The re-read itself failed — the draft stays, the server state is unknown.
        post({ type: 'saveFailed', conflict: false, message: errMsg(e) });
      }
      return;
    }
    if (msg.type === 'loadHierarchy') {
      try {
        post({ type: 'hierEdges', hier: msg.hier, edges: await listWeightedEdges(t.cfg, t.dim, msg.hier) });
      } catch (e) {
        post({ type: 'error', message: errMsg(e) });
      }
      return;
    }
    if (msg.type === 'loadServer') {
      const other = msg.serverId
        ? { id: msg.serverId, cfg: getServerConfig(msg.serverId) }
        : await pickTargetServer(t.serverId, vscode.l10n.t('Compare dimension "{0}" with…', t.dim));
      if (!other) { return; }
      if (!other.cfg) {
        post({ type: 'error', message: vscode.l10n.t('Target server is not connected.') });
        return;
      }
      const label = pickServerLabel(other.cfg.serverUrl, other.id);
      try {
        const edges = await listWeightedEdges(other.cfg, t.dim, hier);
        if (stale()) { return; }
        post({ type: 'serverEdges', serverId: other.id, label, edges });
      } catch (e) {
        post({ type: 'error', message: vscode.l10n.t('{0} on {1} could not be read: {2}',
          t.dim === hier ? t.dim : `${t.dim}:${hier}`, label, errMsg(e)) });
      }
      return;
    }
    if (msg.type === 'pickImportFile') {
      const [uri] = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { [vscode.l10n.t('Edge list')]: ['csv', 'txt', 'tsv', 'json'] },
      }) ?? [];
      if (!uri) { return; }
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      post({ type: 'importText', name: uri.path.split('/').pop() ?? 'import', text });
      return;
    }
    if (msg.type === 'saveView') {
      await saveView(ConsolidationComparePanel.memento, t.serverId, t.dim, t.hier, msg.view);
      return;
    }
    if (msg.type === 'scopeAttr') {
      try {
        const values = msg.attr ? await fetchAttributeValues(t.cfg, t.dim, hier, msg.attr) : {};
        if (stale()) { return; }
        post({ type: 'scopeValues', attr: msg.attr, values });
      } catch (e) {
        post({ type: 'error', message: errMsg(e) });
      }
      return;
    }
    if (msg.type === 'alias') {
      try {
        const values = msg.alias ? await fetchAliasValues(t.cfg, t.dim, hier, msg.alias) : {};
        if (stale()) { return; }
        post({ type: 'aliasValues', alias: msg.alias, values });
      } catch (e) {
        post({ type: 'error', message: errMsg(e) });
      }
      return;
    }
    if (msg.type === 'export') {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(msg.name),
        filters: { CSV: ['csv'] },
      });
      if (!uri) { return; }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.text, 'utf8'));
      post({ type: 'exported', kind: msg.kind, path: uri.fsPath });
    }
  }
}
