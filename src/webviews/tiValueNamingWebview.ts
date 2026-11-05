import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { handleValueNamingMessage } from '../tiValueNaming/handleMessage';
import type { HostToWebview, WebviewToHost as InMsg } from '../tiValueNaming/protocol';
import { VALUENAMING_CSS, valueNamingBody } from './tiValueNamingBody';
import { buildValueNamingL10n } from './tiValueNamingL10n';
import { recordProcessOpen } from '../commands/processEditor/recentBridge';
import { postTo } from './typedPost';

export class ValueNamingPanel {
  private static host: WebviewPanelHost<InMsg>;
  /**
   * Latest cfg per panel key (same pattern as ConsistencyPanel/FindReplacePanel): the
   * `onMessage` closure is wired only on the first `open()` (reveal returns
   * early afterwards), so it reads the cfg from here instead of capturing it —
   * a re-`open()` for a refreshed server config updates this map, so REST no
   * longer fires with the stale first cfg.
   */
  private static readonly cfgByKey = new Map<string, Tm1Config>();
  /** serverId per panel key — needed to record process opens in "Recently opened". */
  private static readonly serverIdByKey = new Map<string, string>();

  static initialize(extensionUri: vscode.Uri): void {
    this.host = new WebviewPanelHost<InMsg>('tm1.valueNaming', 'Unify Variable Names');
    this.host.initialize(extensionUri);
  }

  /** Close the Value Naming panel that belongs to the given server (on disconnect). */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cfg: Tm1Config, serverId?: string, displayName?: string): void {
    if (!this.host) {
      throw new Error('ValueNamingPanel not initialized');
    }
    const key = cfg.serverUrl;
    this.cfgByKey.set(key, cfg);
    if (serverId) { this.serverIdByKey.set(key, serverId); }

    this.host.open({
      key,
      title: vscode.l10n.t('Unify Variable Names: {0}', displayName ?? serverId ?? cfg.serverUrl),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) => {
        const scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'valueNaming.js'),
        );
        const l10n = buildValueNamingL10n();
        return renderWebviewShell({
          cspSource: webview.cspSource,
          css: VALUENAMING_CSS,
          body: valueNamingBody(l10n),
          globals: { __l10n: l10n },
          scriptUris: [String(scriptUri)],
        });
      },
      onMessage: (msg: InMsg, panel: vscode.WebviewPanel) =>
        ValueNamingPanel.onMessage(msg, panel, ValueNamingPanel.cfgByKey.get(key) ?? cfg),
      onDispose: () => {
        ValueNamingPanel.cfgByKey.delete(key);
        ValueNamingPanel.serverIdByKey.delete(key);
      },
    });
  }

  private static async onMessage(
    msg: InMsg,
    panel: vscode.WebviewPanel,
    cfg: Tm1Config,
  ): Promise<void> {
    const { loadExcludes, saveExcludes } = await import('../commands/tiValueNaming/excludeStore');
    if (msg.type === 'getExcludes') {
      postTo<HostToWebview>(panel.webview, { type: 'excludes', entries: loadExcludes(cfg.serverUrl) });
      return;
    }
    if (msg.type === 'setExcludes') {
      await saveExcludes(cfg.serverUrl, msg.entries);
      postTo<HostToWebview>(panel.webview, { type: 'excludes', entries: loadExcludes(cfg.serverUrl) });
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
    // Single-process write (occurrence-scoped split) — confirm before writing to TM1.
    if (msg.type === 'applySplit') {
      const yes = vscode.l10n.t('Split');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t("Rename this value's occurrences of '{0}' to '{1}' in {2}? This writes to TM1.", msg.varLc, msg.newName, msg.process),
        { modal: true },
        yes,
      );
      if (choice !== yes) { return; }
    }
    let out;
    try {
      out = await handleValueNamingMessage(msg, cfg, { excludes: loadExcludes(cfg.serverUrl) });
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
      recordProcessOpen(ValueNamingPanel.serverIdByKey.get(cfg.serverUrl), out.objectName);
      return;
    }
    postTo<HostToWebview>(panel.webview, out);
  }
}
