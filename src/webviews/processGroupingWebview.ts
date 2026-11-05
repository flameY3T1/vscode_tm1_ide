// src/webviews/processGroupingWebview.ts
// Panel for the per-server process grouping (replaces the former
// QuickPick + InputBox pair). The panel is worth the extra surface because the
// pattern modes are only usable with a live preview: you see which groups a
// pattern produces against the server's real process names before saving.
//
// The panel itself is dumb — persistence and tree refresh happen in the
// caller-supplied callbacks (see activation/registerTreeCommands.ts), so this
// module stays free of state handling.

import * as vscode from 'vscode';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { PROCESS_GROUPING_CSS, processGroupingBody } from './processGroupingBody';
import { buildProcessGroupingL10n } from './processGroupingL10n';
import type { ProcessGroupingMode } from '../providers/processGroupingPure';
import type { HostToWebview, WebviewToHost } from '../webviewClient/processGrouping/protocol';
import { postTo } from './typedPost';

export interface ProcessGroupingOpenArgs {
  /** Profile id — panel key, one panel per server. */
  serverId: string;
  /** Display name for title and header. */
  serverName: string;
  /** Currently stored token (empty = no grouping). */
  token: string;
  /** Currently stored mode. */
  mode: ProcessGroupingMode;
  /** Process names for the live preview; empty when the server is not connected. */
  names: string[];
  /** Persist the choice; the panel closes afterwards. */
  onSave: (token: string, mode: ProcessGroupingMode) => Promise<void> | void;
  /** Drop the override; the panel closes afterwards. */
  onReset: () => Promise<void> | void;
}

interface PanelState {
  onSave: ProcessGroupingOpenArgs['onSave'];
  onReset: ProcessGroupingOpenArgs['onReset'];
}

export class ProcessGroupingPanel {
  private static host: WebviewPanelHost<WebviewToHost>;
  /** Latest callbacks per panel key — `open()` returns early on reveal, so the
   *  message handler must not capture them. */
  private static readonly stateByKey = new Map<string, PanelState>();

  /** Idempotent — the command calls it lazily, a second host would orphan open panels. */
  static initialize(extensionUri: vscode.Uri): void {
    if (this.host) { return; }
    this.host = new WebviewPanelHost<WebviewToHost>('tm1.processGrouping', 'Process Grouping');
    this.host.initialize(extensionUri);
  }

  static open(args: ProcessGroupingOpenArgs): void {
    if (!this.host) { throw new Error('ProcessGroupingPanel not initialized'); }
    const key = args.serverId;
    this.stateByKey.set(key, { onSave: args.onSave, onReset: args.onReset });

    const init: HostToWebview = {
      type: 'init',
      serverName: args.serverName,
      token: args.token,
      mode: args.mode,
      names: args.names,
    };

    // Already open: refresh its state (token/mode/names may have changed since)
    // instead of leaving a stale preview behind.
    const existing = this.host.get(key);
    if (existing) {
      void postTo<HostToWebview>(existing.webview, init);
      existing.reveal();
      return;
    }

    this.host.open({
      key,
      title: vscode.l10n.t('Process grouping: {0}', args.serverName),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) => {
        const scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'processGrouping.js'),
        );
        const l10n = buildProcessGroupingL10n();
        return renderWebviewShell({
          cspSource: webview.cspSource,
          title: vscode.l10n.t('Process grouping: {0}', args.serverName),
          css: PROCESS_GROUPING_CSS,
          body: processGroupingBody(l10n),
          globals: { __l10n: l10n, __pgInit: init },
          scriptUris: [String(scriptUri)],
        });
      },
      onMessage: async (msg: WebviewToHost, panel: vscode.WebviewPanel) => {
        const state = ProcessGroupingPanel.stateByKey.get(key);
        if (!state) { return; }
        if (msg.type === 'save') {
          await state.onSave(msg.token, msg.mode);
        } else if (msg.type === 'reset') {
          await state.onReset();
        }
        panel.dispose();
      },
      onDispose: () => { ProcessGroupingPanel.stateByKey.delete(key); },
    });
  }

  /** Close the panel of one server (on disconnect / profile deletion). */
  static disposePanelsForServer(serverId: string): void {
    this.host?.disposePanelsForServer(serverId);
  }
}
