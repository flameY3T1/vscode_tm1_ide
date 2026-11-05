import * as vscode from 'vscode';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { loadReorderInit } from '../commands/cube/reorderDimsInit';
import { renderReorderDimsBody } from '../commands/cube/reorderDimsHtml';
import {
  getStorageDimensionOrder,
  getDimensionLeafCount,
  reorderCubeDimensions,
  ReorderDimensionsError,
} from '../tm1Rest/cubeApi';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { identityTag } from '../tm1Rest/transport/session';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import type { ReorderDimsToHost, ReorderDimsToWebview } from '../webviewClient/reorderDims/protocol';
import { postTo } from './typedPost';

type Msg = ReorderDimsToHost;

const CSS = `
  body { padding: 8px 12px; font-family: var(--vscode-font-family); }
  .cols { display: flex; gap: 16px; align-items: flex-start; }
  .cols section { flex: 1; min-width: 0; }
  h3 { margin: 0 0 6px; font-size: 12px; opacity: .8; }
  ul { list-style: none; margin: 0 0 8px; padding: 0; }
  li { display: flex; align-items: center; gap: 6px; padding: 4px 6px;
       border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 4px; }
  .dn { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cnt { opacity: .6; font-variant-numeric: tabular-nums; }
  .mv button { padding: 0 4px; }
  button { cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
  .warn { color: var(--vscode-editorWarning-foreground); font-size: 12px; margin-bottom: 6px; }
  .result { margin-top: 10px; font-size: 13px; }
  .result.ok { color: var(--vscode-testing-iconPassed); }
  .result.err { color: var(--vscode-errorForeground); }
  .hidden { display: none; }
`;

export class ReorderDimsWebview {
  private static host: WebviewPanelHost<Msg>;

  static initialize(extensionUri: vscode.Uri): void {
    this.host = new WebviewPanelHost<Msg>('tm1.reorderDims', 'Reorder Dimensions');
    this.host.initialize(extensionUri);
  }

  /**
   * Close all reorder windows of this server (on disconnect).
   *
   * Reported 2026-08-30: the window stayed open on disconnect. Two causes
   * at once, and the first is the treacherous one — this module already sat on
   * `WebviewPanelHost`, so it was not the blueprint that was missing, but (a) this
   * function together with its registration in `extension.ts` and (b) the server URL in the
   * key. `disposePanelsForServer` finds a panel only if the
   * key IS the URL or BEGINS with `${url}::`; the key was the
   * bare cube name and would never have been hit even with the guard registered.
   */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static async open(cubeName: string, cfg: Tm1Config): Promise<void> {
    if (!this.host) {
      throw new Error('ReorderDimsWebview not initialized');
    }
    let init;
    try {
      init = await loadReorderInit(cfg, cubeName, { getStorageDimensionOrder, getDimensionLeafCount });
    } catch (e) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Could not load dimension order: {0}', String((e as Error).message)),
      );
      return;
    }

    const labels = {
      current: vscode.l10n.t('Current'),
      recommended: vscode.l10n.t('Recommended'),
      editable: vscode.l10n.t('Editable'),
      use: vscode.l10n.t('Use →'),
      apply: vscode.l10n.t('Apply'),
      up: vscode.l10n.t('Move up'),
      down: vscode.l10n.t('Move down'),
      lastWarn: vscode.l10n.t(
        'The last dimension changed — this can fail on string cubes (the last dimension type must stay the same).',
      ),
    };

    const body = renderReorderDimsBody(init, labels);

    this.host.open({
      // Server URL FIRST and separated with `::` — otherwise the disconnect does not take effect.
      // Identity tag after it: two profiles on one URL get two windows.
      key: `${cfg.serverUrl}::@${identityTag(cfg)}:${cubeName}`,
      title: vscode.l10n.t('Reorder Dimensions — {0}', cubeName),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) =>
        renderWebviewShell({
          cspSource: webview.cspSource,
          css: CSS,
          body,
          scriptUris: [String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'reorderDims.js')))],
        }),
      onMessage: (msg: Msg, panel: vscode.WebviewPanel) =>
        ReorderDimsWebview.onMessage(msg, panel, cubeName, cfg),
    });
  }

  private static async onMessage(
    msg: Msg,
    panel: vscode.WebviewPanel,
    cubeName: string,
    cfg: Tm1Config,
  ): Promise<void> {
    if (msg.type !== 'apply') {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Reorder dimensions of "{0}"? This rebuilds the cube in memory and temporarily needs about TWICE the cube\'s RAM. Requires admin rights.',
        cubeName,
      ),
      { modal: true },
      vscode.l10n.t('Reorder'),
    );
    if (!confirm) {
      postTo<ReorderDimsToWebview>(panel.webview, { type: 'info', message: vscode.l10n.t('Cancelled.') });
      return;
    }
    try {
      const pct = await reorderCubeDimensions(cfg, cubeName, msg.order);
      const current = await getStorageDimensionOrder(cfg, cubeName);
      const counts: Record<string, number | null> = {};
      await Promise.all(
        current.map(async (d) => {
          counts[d] = await getDimensionLeafCount(cfg, d);
        }),
      );
      postTo<ReorderDimsToWebview>(panel.webview, {
        type: 'applied',
        current,
        counts,
        message: vscode.l10n.t('Done. Memory change: {0}%', pct.toFixed(2)),
      });
    } catch (e) {
      const err = e as ReorderDimensionsError;
      let message: string;
      if (err.kind === 'versionGate') {
        message = vscode.l10n.t(
          'This TM1 server is too old — dimension reordering needs version 11.4 or newer.',
        );
      } else if (err.kind === 'typeConstraint') {
        message = vscode.l10n.t(
          'Reorder failed: the last dimension type must stay the same (string vs numeric).',
        );
      } else {
        message = vscode.l10n.t('Reorder failed: {0}', String(err.message));
      }
      postTo<ReorderDimsToWebview>(panel.webview, { type: 'error', message });
    }
  }
}

registerServerDisposer('reorderDims', (url) => ReorderDimsWebview.disposePanelsForServer(url));
