import * as vscode from 'vscode';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from './columnResize';
import { savedColumnWidths, rememberColumnWidths } from './columnWidthStore';
import { FEEDER_AUDIT_CSS, feederAuditBody } from './feederAuditBodyPure';
import { buildFeederAuditL10n } from './feederAuditL10n';

import type { AuditResult, AuditFeeder, AuditHit, HostToWebview, WebviewToHost } from '../webviewClient/feederAudit/protocol';
import { postTo } from './typedPost';
export type { AuditResult, AuditFeeder, AuditHit } from '../webviewClient/feederAudit/protocol';

/** Messages from the window. */
export type FeederAuditMsg = WebviewToHost;

export interface FeederAuditCallbacks {
  /**
   * Look up the feeders for ONE cell — only when the row is expanded.
   *
   * Before, this ran in one go over all hits, and that was the expensive part:
   * the rule text is fast, but `loadModelKnowledge` fetches the element trees
   * of all dimensions, and then every cell is held against every FEEDERS statement.
   * With 10000 hits someone pays for that who only wanted to look at two of
   * them.
   */
  onMatchCell: (index: number, hit: AuditHit) => void | Promise<void>;
  /** Open the rule editor at a feeder line. */
  onOpenRule: (line: number) => void | Promise<void>;
  /** Run the same run again, over this cell range. */
  onRerun: (from: number, to: number, clearCache: boolean) => void | Promise<void>;
}

/**
 * Window for the overfeeding findings.
 *
 * Why a window of its own and not a quick pick: the finding needs
 * explanation. Overfeeding goes unnoticed because the numbers are right;
 * the run has a side effect that hits all sessions of the server
 * (clearing the cache); and the feeder assignment is a suspicion, not proof, because
 * TM1 knows no backward search. That does not fit into one line of message.
 */
export class FeederAuditPanel {
  private static host: WebviewPanelHost<FeederAuditMsg>;
  /** Last result per window — a click on a row looks it up here. */
  private static readonly resultByKey = new Map<string, AuditResult>();
  private static readonly callbacksByKey = new Map<string, FeederAuditCallbacks>();

  static initialize(extensionUri: vscode.Uri): void {
    this.host = new WebviewPanelHost<FeederAuditMsg>('tm1.feederAudit', 'Overfed cells');
    this.host.initialize(extensionUri);
  }

  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  /** Key with the server identifier in front — otherwise `disposePanelsForServer` never finds it. */
  private static keyOf(serverUrl: string, cube: string): string {
    return `${serverUrl}::feeder#${cube}`;
  }

  /**
   * Open the window (or bring an existing one forward) and put it into the run
   * state. The result arrives later via {@link show} — also twice,
   * once with the cells and once with the feeder assignment added later.
   */
  static open(
    serverUrl: string, cube: string, callbacks: FeederAuditCallbacks, serverName?: string,
  ): string {
    if (!this.host) { throw new Error('FeederAuditPanel not initialized'); }
    const key = this.keyOf(serverUrl, cube);
    this.callbacksByKey.set(key, callbacks);
    const l = buildFeederAuditL10n();

    if (!this.host.reveal(key)) {
      const panel = this.host.open({
        key,
        title: serverName
          ? vscode.l10n.t('Overfed: {0} — {1}', cube, serverName)
          : vscode.l10n.t('Overfed: {0}', cube),
        html: (webview: vscode.Webview, extensionUri: vscode.Uri) => renderWebviewShell({
          cspSource: webview.cspSource,
          title: l.heading,
          css: FEEDER_AUDIT_CSS + COLUMN_RESIZE_CSS,
          body: feederAuditBody(l),
          globals: { __feederAuditL10n: l },
          scriptUris: [String(webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'feederAudit.js')))],
          inlineScript: columnResizeScript('feederAudit', savedColumnWidths('feederAudit')),
        }),
        onMessage: (msg: FeederAuditMsg) => FeederAuditPanel.onMessage(key, msg),
        onDispose: () => {
          FeederAuditPanel.resultByKey.delete(key);
          FeederAuditPanel.callbacksByKey.delete(key);
        },
      });
      if (panel) { rememberColumnWidths(panel, 'feederAudit'); }
    } else {
      // A reused window would otherwise show the old result while a new run
      // is already running.
      void postTo<HostToWebview>(this.host.get(key)?.webview, { type: 'running' });
    }
    return key;
  }

  /** Put the result (or error) into the window. */
  static show(key: string, result: AuditResult): void {
    this.resultByKey.set(key, result);
    // The window may have been closed in the meantime — the run takes a while.
    void postTo<HostToWebview>(this.host?.get(key)?.webview, { type: 'result', ergebnis: result });
  }

  /** The feeder assignment of a single row, supplied later. */
  static showCell(key: string, index: number, feeder: AuditFeeder[], error?: string): void {
    const t = this.resultByKey.get(key)?.treffer[index];
    if (t) { t.feeder = feeder; t.feederFehler = error; }
    void postTo<HostToWebview>(this.host?.get(key)?.webview, { type: 'cellFeeder', index, feeder, fehler: error });
  }

  private static async onMessage(key: string, msg: FeederAuditMsg): Promise<void> {
    const cb = this.callbacksByKey.get(key);
    if (!cb) { return; }
    if (msg.type === 'rerun') { await cb.onRerun(msg.von, msg.bis, msg.cacheLeeren); return; }
    if (msg.type === 'openRule') { await cb.onOpenRule(msg.zeile); return; }
    if (msg.type === 'matchCell') {
      const t = this.resultByKey.get(key)?.treffer[msg.index];
      if (t) { await cb.onMatchCell(msg.index, t); }
    }
  }
}
