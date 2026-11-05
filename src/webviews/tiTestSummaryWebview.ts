/**
 * Manager for the Folder-Run Summary Webview. Wraps `renderSummaryHtml`
 * with a `vscode.WebviewPanel` and routes postMessage events
 * (showDiff / rerunAll / rerunFailed) into caller-supplied handlers so
 * the summary view can drive subsequent commands.
 *
 * Lifecycle via `WebviewPanelHost` (lever B, 2026-08-30). No
 * `disposePanelsForServer`: the key is a folder on disk, not a
 * server — a check run holds no `Tm1Config`.
 */

import * as vscode from 'vscode';
import { renderSummaryHtml, type SummaryRow } from './renderSummaryHtml';
import { getNonce as makeNonce } from '../utils/nonce';
import { WebviewPanelHost } from './webviewPanelHost';

const VIEW_TYPE = 'tm1.tiTestSummary';

export type SummaryHandlers = {
  onShowDiff: (folder: string) => void | Promise<void>;
  onRerunAll: () => void | Promise<void>;
  onRerunFailed: () => void | Promise<void>;
};

type SummaryMsg = { type: string; folder?: string };

export class TiTestSummaryWebviewManager {
  private readonly host = new WebviewPanelHost<SummaryMsg>(VIEW_TYPE, 'TI Tests');

  private readonly root: vscode.Uri;

  constructor(extensionUri?: vscode.Uri) {
    // Without a root there used to be `localResourceRoots: []`; the host wants a
    // Uri. The substitute root leads to paths that do not exist — just as
    // ineffective as the empty list, but the host stays operable.
    this.root = extensionUri ?? vscode.Uri.file('/');
    this.host.initialize(this.root);
  }

  show(
    folderKey: string,
    folderLabel: string,
    rows: SummaryRow[],
    handlers: SummaryHandlers,
  ): void {
    const panel = this.host.get(folderKey) ?? this.host.open({
      key: folderKey,
      title: vscode.l10n.t('TI Tests: {0}', folderLabel),
      // Filled right below, once the panel exists to resolve the bundle URI.
      html: () => '',
      onMessage: (msg) => {
        switch (msg.type) {
          case 'showDiff':
            if (msg.folder) void handlers.onShowDiff(msg.folder);
            break;
          case 'rerunAll':
            void handlers.onRerunAll();
            break;
          case 'rerunFailed':
            void handlers.onRerunFailed();
            break;
        }
      },
    });
    if (!panel) { return; }

    panel.title = vscode.l10n.t('TI Tests: {0}', folderLabel);
    panel.webview.html = renderSummaryHtml({
      folderLabel, rows, cspNonce: makeNonce(),
      scriptUri: String(panel.webview.asWebviewUri(vscode.Uri.joinPath(this.root, 'out', 'webview', 'tiTestSummary.js'))),
    });
    // Without a column argument: the panel stays where it is. `preserveFocus`,
    // because a refresh must not take the focus away from the user.
    panel.reveal(undefined, true);
  }

  dispose(): void {
    this.host.disposeAll();
  }
}
