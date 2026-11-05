import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import { runWithAbortSignal } from '../../tm1Rest/transport/abortScope';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import { deleteView } from '../../tm1Rest/cubeApi';
import { logBestEffort } from '../../providers/bestEffortLog';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/cubeViewerMonaco/protocol';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { getCubeViewerHtml } from './cubeViewerWebview';
import { _activeInlineMdx, _dimSelections, _panels, _tempViews, clearRefreshState, cubeViewerTitle, post } from './state';
import { dropPanelCellset } from './cellsetState';
import { hierKey } from '../../utils/hierKeyPure';
import { _fetchCubeDimensions, _fetchCubeHierarchies, _fetchViewAxisConfig, type TitleSubset } from './fetch';
import { fetchViewDimAliases } from './alias';
import { _handleMessage, clearPanelMessagingState } from './messaging';
import { invalidateDimStructure } from './dimStructCache';
import { errMsg } from '../../utils/errMsg';
import { registerWindow, unregisterWindow } from '../../workbench/windowRegistry';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

export class CubeViewerManager {
  private static _extensionUri: vscode.Uri | null = null;

  /** Wire the extension's URI so panels can resolve `out/webview/cubeViewerMonaco.js`. */
  static initialize(extensionUri: vscode.Uri): void {
    CubeViewerManager._extensionUri = extensionUri;
  }

  /**
   * `initialMdxRun` distinguishes the two meanings of `initialMdx`:
   * `newMdxViewCommand` passes in a TEMPLATE (that belongs in the MDX
   * window), restoring a workbench passes in the last-shown STATE (that
   * belongs executed). The default stays the old one.
   */
  static async open(cubeName: string, config: Tm1Config, existingViewName?: string, existingViewIsPrivate?: boolean, initialMdx?: string, initialMdxRun?: boolean): Promise<void> {
    if (!CubeViewerManager._extensionUri) {
      throw new Error('CubeViewerManager.initialize() must be called before open()');
    }
    const serverKey = config?.serverUrl ?? '__default__';
    const privPart  = existingViewIsPrivate ? ':priv' : '';
    // Separate panel per view; cube-only panel when no view specified. The
    // identity tag keeps two profiles on one URL apart (see identityTag).
    const scope     = `${serverKey}:@${identityTag(config)}`;
    const panelKey  = existingViewName
      ? `${scope}:${cubeName}:${existingViewName}${privPart}`
      : `${scope}:${cubeName}`;

    const existing = _panels.get(panelKey);
    // Without a column argument: the panel stays where it is (per the d.ts
    // "Shows in the current WebviewPanel.viewColumn if undefined") — an open
    // viewer should not migrate back to the main window when reopened.
    if (existing) { existing.reveal(); return; }

    const title = cubeViewerTitle(formatServerLabel(config?.serverUrl, getServerNameByUrl), cubeName, existingViewName);
    const panel = vscode.window.createWebviewPanel(
      'tm1CubeViewer', title,
      // Symbolic column: the viewer opens in the currently active group and
      // so in the same window as the click that triggered it.
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(CubeViewerManager._extensionUri, 'out'),
          vscode.Uri.joinPath(CubeViewerManager._extensionUri, 'media'),
        ],
      },
    );
    setPanelIcon(panel, 'tm1CubeViewer');
    muteWebviewOnDispose(panel);
    _panels.set(panelKey, panel);
    registerWindow({
      kind: 'tm1CubeViewer', rawKey: panelKey, panel,
      serverId: serverKey, target: cubeName,
    });
    panel.webview.html = getCubeViewerHtml(panel.webview, CubeViewerManager._extensionUri);

    // Stored after dims are fetched so the webviewReady handler can re-send it.
    let initDataPayload: Extract<HostToWebview, { type: 'initData' }> | undefined;
    // initData goes out once per webview load: posted both after the reads and
    // on `webviewReady`, it arrived twice and every open ran its first query
    // twice (trace 2026-11-03).
    let webviewReady = false;
    // Reads still in flight when the panel closes are cancelled (GET only),
    // same as panels built on WebviewPanelHost.
    const abort = new AbortController();

    const msgSub = panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      if (!msg?.type) { return; }
      // Webview signals all listeners are registered (again after a reload).
      if (msg.type === 'webviewReady') {
        webviewReady = true;
        if (initDataPayload) { post(panel, initDataPayload); }
        return;
      }
      try {
        await runWithAbortSignal(abort.signal, () =>
          _handleMessage(panelKey, panel, msg, cubeName, existingViewName, !!existingViewIsPrivate, config));
      } catch (err) { post(panel, { type: 'error', message: errMsg(err) }); }
    });

    panel.onDidDispose(() => {
      abort.abort();
      unregisterWindow(panel);
      msgSub.dispose();
      _panels.delete(panelKey);
      _dimSelections.delete(panelKey);
      _activeInlineMdx.delete(panelKey);
      clearRefreshState(panelKey);
      clearPanelMessagingState(panelKey);
      dropPanelCellset(panelKey);
      // The structure cache holds on to level and parent maps of large
      // dimensions. As long as a viewer is still open, that is exactly its
      // purpose — on the last one it turns into held memory with no consumer.
      if (_panels.size === 0) { invalidateDimStructure(); }
      const tv = _tempViews.get(panelKey);
      if (tv) {
        _tempViews.delete(panelKey);
        deleteView(tv.config, tv.cubeName, tv.viewName, false, 10000)
          .catch(e => logBestEffort('CubeViewer', `delete temp view "${tv.viewName}"`, e));
      }
    });

    await runWithAbortSignal(abort.signal, async () => {
      try {
        const [dims, { hierarchies, defaults: defaultHiers }] = await Promise.all([
          _fetchCubeDimensions(cubeName, config),
          _fetchCubeHierarchies(cubeName, config),
        ]);
        if (dims.length === 0) {
          vscode.window.showErrorMessage(vscode.l10n.t('TM1 Cube Viewer: No dimensions found for "{0}".', cubeName));
          panel.dispose(); return;
        }

        // Viewer keys: a default hierarchy not named like its dimension is
        // addressed explicitly (`a:b`), `[a].[a]` does not exist there.
        const defKey = (d: string) => hierKey(d, defaultHiers[d] ?? d);
        let rowDim = defKey(dims[0]);
        let colDim = defKey(dims[1] ?? dims[0]);
        let suppressRows = false;
        let suppressCols = false;

        let isMdx = false;
        let viewMdx: string | undefined;
        let titleSubsets: Record<string, TitleSubset> | undefined;
        // Aliases belong to the view, so they must travel on the FIRST open too —
        // not only on a later view switch (`messaging.ts#viewSwitched`). Without
        // this, a saved view opened straight from the tree never showed its alias.
        let dimAliases: Record<string, string> = {};
        if (existingViewName) {
          const [ax, aliases] = await Promise.all([
            _fetchViewAxisConfig(cubeName, existingViewName, !!existingViewIsPrivate, config),
            fetchViewDimAliases(cubeName, existingViewName, !!existingViewIsPrivate, config),
          ]);
          // Two carriers, one channel: a native view stores the alias on its axis
          // subset (`aliases`), an MDX view in the `DIMENSION PROPERTIES` clause of
          // its MDX text (`ax.dimAliases`). Exactly one of them ever answers for a
          // given view, so merging is enough — the native value wins on the
          // theoretical overlap.
          dimAliases = { ...(ax?.dimAliases ?? {}), ...aliases };
          if (ax) {
            rowDim = ax.rowDim ?? rowDim;
            colDim = ax.colDim ?? colDim;
            suppressRows = !!ax.suppressRows;
            suppressCols = !!ax.suppressCols;
            isMdx = ax.isMdx;
            viewMdx = ax.mdx;
            titleSubsets = ax.titleSubsets;
          }
        }

        // autoLoad=true tells the webview to fire refreshData immediately on open.
        // Opening from a cube node (no view) auto-loads the default layout
        // (first two dims on rows/cols, default members) — matches TM1 Architect
        // double-click-cube behaviour. Needs ≥2 distinct dims for a temp view;
        // a 1-dim cube falls back to the placeholder (refresh would throw).
        // Before `webviewReady` nobody listens yet; the payload then waits for it.
        const autoLoad = existingViewName ? true : (colDim !== rowDim);
        initDataPayload = {
          type: 'initData',
          cubeName, dimensions: dims, hierarchies, defaultHiers, rowDim, colDim,
          existingViewName: existingViewName ?? null,
          existingViewIsPrivate: !!existingViewIsPrivate,
          suppressRows, suppressCols,
          autoLoad,
          isMdx,
          mdx: viewMdx ?? null,
          initialMdx: initialMdx ?? null,
          initialMdxRun: initialMdxRun === true,
          titleSubsets: titleSubsets ?? null,
          dimAliases,
        };
        if (webviewReady) { post(panel, initDataPayload); }
      } catch (err) {
        post(panel, { type: 'error', message: errMsg(err) });
      }
    });
  }

  static disposeAll(): void {
    for (const p of _panels.values()) { p.dispose(); }
    _panels.clear(); _tempViews.clear(); _dimSelections.clear();
    invalidateDimStructure();
  }

  /** Close every cube-viewer panel that belongs to the given server. */
  static disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    const prefix = `${serverUrl}:`;
    const toClose: vscode.WebviewPanel[] = [];
    for (const [key, panel] of _panels) {
      if (key.startsWith(prefix)) { toClose.push(panel); }
    }
    for (const p of toClose) { p.dispose(); }
  }
}

registerServerDisposer('cubeViewer', (url) => CubeViewerManager.disposePanelsForServer(url));
