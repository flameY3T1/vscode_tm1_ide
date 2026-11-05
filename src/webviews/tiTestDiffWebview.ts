/**
 * Manager for the per-test Diff-Webview. Wraps `renderDiffHtml` with a
 * `vscode.WebviewPanel`, caches one panel per test-folder so reopening
 * focuses instead of duplicating, and applies a CSP nonce per show.
 *
 * Lifecycle via `WebviewPanelHost` (lever B, 2026-08-30). No
 * `disposePanelsForServer`: the key is a folder on disk, not a
 * server.
 */

import * as vscode from 'vscode';
import { renderDiffHtml } from './renderDiffHtml';
import type { Manifest } from '../tiTestFramework/storage/manifestIo';
import type { DiffResult, DiffSummary } from '../tiTestFramework/diff/diffResult';
import { getNonce as makeNonce } from '../utils/nonce';
import { WebviewPanelHost } from './webviewPanelHost';

const VIEW_TYPE = 'tm1.tiTestDiff';

export class TiTestDiffWebviewManager {
  private readonly host = new WebviewPanelHost<unknown>(VIEW_TYPE, 'TI Test');

  private readonly root: vscode.Uri;

  constructor(extensionUri?: vscode.Uri) {
    // See `tiTestSummaryWebview`: without a root there used to be an empty
    // list here, the host wants a Uri.
    this.root = extensionUri ?? vscode.Uri.file('/');
    this.host.initialize(this.root);
  }

  private scriptUri(panel: vscode.WebviewPanel): string {
    return String(panel.webview.asWebviewUri(vscode.Uri.joinPath(this.root, 'out', 'webview', 'tiTestDiff.js')));
  }

  /**
   * Refresh the panel for `testFolder` if one is already open. Does NOT
   * create a new panel and does NOT bring it to the foreground — used for
   * pass-state updates so a stale fail view doesn't linger.
   */
  updateIfOpen(
    testFolder: string,
    manifest: Manifest,
    diff: DiffResult,
    summary: DiffSummary,
    cubeDims?: Record<string, string[]>,
  ): void {
    const panel = this.host.get(testFolder);
    if (!panel) return;
    const nonce = makeNonce();
    panel.title = vscode.l10n.t('TI Test: {0}', manifest.name);
    panel.webview.html = renderDiffHtml({
      manifest,
      diff,
      summary,
      cspNonce: nonce,
      cubeDims,
      scriptUri: this.scriptUri(panel),
    });
  }

  show(
    testFolder: string,
    manifest: Manifest,
    diff: DiffResult,
    summary: DiffSummary,
    cubeDims?: Record<string, string[]>,
  ): void {
    const panel = this.host.get(testFolder) ?? this.host.open({
      key: testFolder,
      title: vscode.l10n.t('TI Test: {0}', manifest.name),
      // Filled right below, once the panel exists to resolve the bundle URI.
      html: () => '',
      // The diff view sends nothing back; the host nevertheless requires
      // a receiver.
      onMessage: () => {},
    });
    if (!panel) { return; }

    panel.title = vscode.l10n.t('TI Test: {0}', manifest.name);
    panel.webview.html = renderDiffHtml({
      manifest, diff, summary, cspNonce: makeNonce(), cubeDims, scriptUri: this.scriptUri(panel),
    });
    // Without a column argument: the panel stays where it is. `preserveFocus`,
    // so that a refresh does not take the focus away.
    panel.reveal(undefined, true);
  }

  dispose(): void {
    this.host.disposeAll();
  }
}
