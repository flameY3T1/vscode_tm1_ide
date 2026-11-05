import * as vscode from 'vscode';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { renderCellSecurityBuilderBody } from './cellSecurityBuilderHtml';
import { buildCellSecurityCubeBody } from './cellSecurityCubePure';
import { createCube } from '../../tm1Rest/cubeApi';
import { CubeViewerManager } from '../cubeViewer/manager';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import { errMsg } from '../../utils/errMsg';
import type { CellSecurityToHost, CellSecurityToWebview } from '../../webviewClient/cellSecurityBuilder/protocol';
import { postTo } from '../../webviews/typedPost';

type Msg = CellSecurityToHost;

const CSS = `
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
h2 { margin-top: 0; }
.hint { opacity: 0.75; margin-bottom: 12px; }
ul#dims, ul.fixed { list-style: none; padding: 0; margin: 0 0 8px; }
ul#dims li, ul.fixed li { padding: 2px 0; }
.dn { font-weight: 500; }
.note { opacity: 0.65; font-size: 0.9em; margin-left: 6px; }
#create { margin-top: 12px; padding: 6px 14px; }
.result { margin-top: 10px; }
.result.err { color: var(--vscode-errorForeground); }
.result.ok { color: var(--vscode-charts-green); }
`;

export class CellSecurityBuilderWebview {
  private static host: WebviewPanelHost<Msg>;

  static initialize(extensionUri: vscode.Uri): void {
    this.host = new WebviewPanelHost<Msg>('tm1.cellSecurityBuilder', 'Cell Security');
    this.host.initialize(extensionUri);
  }

  /**
   * Close all cell-security builders of this server (on disconnect).
   *
   * The same gap as with the reorder window: on the host, but without a
   * guard and with the bare cube name as the key — which
   * `disposePanelsForServer` never matches. The five security matrices next
   * to it are keyed by `serverId` and are closed via a URL-to-id resolution;
   * here the `Tm1Config` itself is already available, so the URL is used
   * directly.
   */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cubeName: string, sourceDims: string[], cfg: Tm1Config): void {
    if (!this.host) {
      throw new Error('CellSecurityBuilderWebview not initialized');
    }
    const labels = {
      heading: vscode.l10n.t('Create Cell Security Cube — {0}', cubeName),
      hint: vscode.l10n.t('Pick dimensions to secure on. Fewer dimensions = leaner, faster cell-security cube.'),
      groupsRow: vscode.l10n.t('always included (last)'),
      create: vscode.l10n.t('Create'),
    };
    const body = renderCellSecurityBuilderBody(cubeName, sourceDims, labels);
    this.host.open({
      // Server URL FIRST and separated with `::` — otherwise disconnect handling does not take effect.
      // Identity tag after it: two profiles on one URL get two windows.
      key: `${cfg.serverUrl}::@${identityTag(cfg)}:${cubeName}`,
      title: vscode.l10n.t('Cell Security — {0}', cubeName),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) =>
        renderWebviewShell({
          cspSource: webview.cspSource,
          css: CSS,
          body,
          scriptUris: [String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'cellSecurityBuilder.js')))],
        }),
      onMessage: (msg: Msg, panel: vscode.WebviewPanel) =>
        this.onMessage(msg, panel, cubeName, sourceDims, cfg),
    });
  }

  private static async onMessage(
    msg: Msg,
    panel: vscode.WebviewPanel,
    cubeName: string,
    sourceDims: string[],
    cfg: Tm1Config,
  ): Promise<void> {
    if (msg.type !== 'create') {
      return;
    }
    if (!msg.selected || msg.selected.length === 0) {
      void postTo<CellSecurityToWebview>(panel.webview, {
        type: 'error',
        message: vscode.l10n.t('Select at least one dimension.'),
      });
      return;
    }
    let cubeBody: string;
    try {
      cubeBody = buildCellSecurityCubeBody(cubeName, sourceDims, msg.selected);
    } catch (e) {
      const reason = errMsg(e);
      void postTo<CellSecurityToWebview>(panel.webview, {
        type: 'error',
        message: vscode.l10n.t('Could not create cell-security cube: {0}', reason),
      });
      return;
    }
    try {
      await createCube(cfg, cubeBody);
    } catch (e) {
      const reason = errMsg(e);
      void postTo<CellSecurityToWebview>(panel.webview, {
        type: 'error',
        message: vscode.l10n.t('Could not create cell-security cube: {0}', reason),
      });
      return;
    }
    panel.dispose();
    await CubeViewerManager.open(`}CellSecurity_${cubeName}`, cfg);
  }
}
