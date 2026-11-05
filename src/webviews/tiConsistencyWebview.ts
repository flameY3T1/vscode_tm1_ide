import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { handleConsistencyMessage } from '../tiConsistency/handleMessage';
import type { HostToWebview, WebviewToHost as InMsg } from '../tiConsistency/protocol';
import { CONSISTENCY_CSS, consistencyBody } from './tiConsistencyBody';
import { buildConsistencyL10n } from './tiConsistencyL10n';
import { recordProcessOpen } from '../commands/processEditor/recentBridge';
import { postTo } from './typedPost';

export class ConsistencyPanel {
  private static host: WebviewPanelHost<InMsg>;
  /**
   * Latest cfg per panel key (same pattern as FindReplacePanel): the
   * `onMessage` closure is wired only on the first `open()` (reveal returns
   * early afterwards), so it reads the cfg from here instead of capturing it —
   * a re-`open()` for a refreshed server config updates this map, so REST no
   * longer fires with the stale first cfg.
   */
  private static readonly cfgByKey = new Map<string, Tm1Config>();
  /** serverId per panel key — needed to record process opens in "Recently opened". */
  private static readonly serverIdByKey = new Map<string, string>();

  static initialize(extensionUri: vscode.Uri): void {
    this.host = new WebviewPanelHost<InMsg>('tm1.consistencyNormalizer', 'Normalize Naming & Casing');
    this.host.initialize(extensionUri);
  }

  /** Close the TI Consistency panel that belongs to the given server (on disconnect). */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cfg: Tm1Config, serverId?: string, displayName?: string): void {
    if (!this.host) {
      throw new Error('ConsistencyPanel not initialized');
    }
    const key = cfg.serverUrl;
    this.cfgByKey.set(key, cfg);
    if (serverId) { this.serverIdByKey.set(key, serverId); }

    this.host.open({
      key,
      title: vscode.l10n.t('Normalize Naming & Casing: {0}', displayName ?? serverId ?? cfg.serverUrl),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) => {
        const scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'tiConsistency.js'),
        );
        const l10n = buildConsistencyL10n();
        return renderWebviewShell({
          cspSource: webview.cspSource,
          css: CONSISTENCY_CSS,
          body: consistencyBody(l10n),
          globals: { __l10n: l10n },
          scriptUris: [String(scriptUri)],
        });
      },
      onMessage: (msg: InMsg, panel: vscode.WebviewPanel) =>
        ConsistencyPanel.onMessage(msg, panel, ConsistencyPanel.cfgByKey.get(key) ?? cfg),
      onDispose: () => {
        ConsistencyPanel.cfgByKey.delete(key);
        ConsistencyPanel.serverIdByKey.delete(key);
      },
    });
  }

  private static async onMessage(
    msg: InMsg,
    panel: vscode.WebviewPanel,
    cfg: Tm1Config,
  ): Promise<void> {
    // Naming prefixes are shared with the linter config (globalState tm1.lintConfig,
    // keyed by serverUrl — the same key the process-editor linter uses), so edits
    // here propagate to the linter and vice versa.
    const { loadLintConfig, saveLintConfig } = await import('../commands/processEditor/lintConfigStore');
    if (msg.type === 'getPrefixes') {
      postTo<HostToWebview>(panel.webview, { type: 'prefixes', prefixes: loadLintConfig(cfg.serverUrl).namingPrefixes ?? {} });
      return;
    }
    if (msg.type === 'setNamingPrefixes') {
      const cur = loadLintConfig(cfg.serverUrl);
      await saveLintConfig(cfg.serverUrl, { ...cur, namingPrefixes: msg.prefixes });
      postTo<HostToWebview>(panel.webview, { type: 'prefixes', prefixes: msg.prefixes });
      return;
    }
    // Bulk write — confirm before touching many processes at once.
    if (msg.type === 'applyAll') {
      if (msg.targets.length === 0) { return; }
      const yes = vscode.l10n.t('Apply all');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Apply all {0} findings to the selected processes? This writes to TM1.', String(msg.targets.length)),
        { modal: true },
        yes,
      );
      if (choice !== yes) { return; }
    }
    let out;
    try {
      out = await handleConsistencyMessage(msg, cfg, { namingPrefixes: loadLintConfig(cfg.serverUrl).namingPrefixes });
    } catch (e) {
      // A REST failure (server down / 401 / timeout) must still clear the
      // webview's loading bar — it clears on any inbound message. Post one,
      // then rethrow so WebviewPanelHost surfaces the error toast as before.
      postTo<HostToWebview>(panel.webview, { type: 'error' });
      throw e;
    }
    if (!out) { return; }
    if ('route' in out) {
      const { openProcess } = await import('../commands/processEditor/openPanel');
      await openProcess(out.objectName, undefined, cfg, { section: out.unit, line: out.line });
      recordProcessOpen(ConsistencyPanel.serverIdByKey.get(cfg.serverUrl), out.objectName);
      return;
    }
    postTo<HostToWebview>(panel.webview, out);
  }
}
