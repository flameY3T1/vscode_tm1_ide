import * as vscode from 'vscode';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { buildFindReplaceL10n } from './findReplaceL10n';
import { fetchCorpus, applyEdits } from '../findReplace/corpus';
import { runSearch, planReplace, filterCorpus } from '../findReplace/model';
import type { ApplyReport, HostToWebview, WebviewToHost as InMsg } from '../findReplace/protocol';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { identityTag } from '../tm1Rest/transport/session';
import type { L10nMap } from '../webviewClient/_shared/l10n';
import { recordProcessOpen, recordRuleOpen } from '../commands/processEditor/recentBridge';
import { postTo } from './typedPost';

const findReplaceBody = (t: L10nMap) => `
  <div id="fr-bar">
    <input id="fr-q" type="text" placeholder="${t.searchPlaceholder}" />
    <input id="fr-r" type="text" placeholder="${t.replacePlaceholder}" />
    <label><input id="fr-word" type="checkbox" /> ${t.wholeWord}</label>
    <label><input id="fr-rx" type="checkbox" /> ${t.regex}</label>
    <button id="fr-search">${t.search}</button>
    <button id="fr-replace" disabled>${t.replace}</button>
    <span id="fr-summary"></span>
  </div>
  <div id="fr-filter">
    <label><input id="fr-proc" type="checkbox" checked /> ${t.processes}</label>
    <label><input id="fr-rule" type="checkbox" checked /> ${t.rules}</label>
    <span class="fr-flabel">${t.nameFilterLabel}</span>
    <input id="fr-prefix" type="text" placeholder="${t.prefixPlaceholder}" />
    <input id="fr-contains" type="text" placeholder="${t.containsPlaceholder}" />
    <input id="fr-suffix" type="text" placeholder="${t.suffixPlaceholder}" />
    <label><input id="fr-control" type="checkbox" /> ${t.includeControl}</label>
  </div>
  <div id="fr-results" data-empty="${t.resultsEmpty}"></div>`;

const CSS = `
  #fr-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px; position: sticky; top: 0;
    background: var(--vscode-editor-background); }
  #fr-q, #fr-r, #fr-prefix, #fr-suffix, #fr-contains { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; }
  #fr-filter { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 0 6px 6px; }
  #fr-prefix, #fr-suffix, #fr-contains { flex: 1 1 160px; min-width: 110px; }
  .fr-flabel { color: var(--vscode-descriptionForeground); font-size: 12px; margin-left: 4px; }
  #fr-summary { color: var(--vscode-descriptionForeground); margin-left: auto; }
  #fr-results { padding: 4px 8px; }
  #fr-results:empty::before { content: attr(data-empty); color: var(--vscode-descriptionForeground); font-style: italic; display: block; padding: 4px 0; }
  .fr-obj { font-weight: 600; margin: 8px 0 2px; cursor: pointer; width: fit-content; }
  .fr-obj:hover { text-decoration: underline; }
  .fr-row { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; cursor: pointer; white-space: nowrap; }
  .fr-badge { font-size: 10px; text-transform: uppercase; opacity: .8; min-width: 58px; }
  .fr-ln { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }
  .fr-snip { font-family: var(--vscode-editor-font-family, monospace); overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
  .fr-sel { display: flex; align-items: baseline; gap: 6px; flex: 0 0 auto; cursor: pointer; }
  .fr-snip:hover { text-decoration: underline; }
  .fr-match { font-weight: 700; color: var(--vscode-editor-findMatchHighlightForeground, inherit); }
  .fr-report { padding: 4px 0; font-weight: 600; }
  .fr-names { padding: 0 0 2px; color: var(--vscode-descriptionForeground); font-size: 12px;
    overflow-wrap: anywhere; }
  .fr-warn { padding: 4px 0; color: var(--vscode-editorWarning-foreground, orange); }
  input[type=text], #fr-q, #fr-r, #fr-prefix, #fr-suffix { border-radius: 2px; height: 26px; box-sizing: border-box; font-family: inherit; font-size: 13px; }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  input[type=text]:focus, #fr-q:focus, #fr-r:focus, #fr-prefix:focus, #fr-suffix:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 4px 12px; height: 26px; font-family: inherit; font-size: 13px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  input[type=checkbox] { vertical-align: -1px; margin: 0; }
  input[type=checkbox]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
  body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
`;

export class FindReplacePanel {
  private static host: WebviewPanelHost<InMsg>;
  /**
   * Latest cfg per panel key. The `onMessage` closure is wired only on the
   * first `open()` (reveal returns early afterwards), so it reads the cfg from
   * here instead of capturing it — a re-`open()` for a refreshed server config
   * updates this map, so REST no longer fires with the stale first cfg.
   */
  private static readonly cfgByKey = new Map<string, Tm1Config>();
  /**
   * serverId per panel key — needed to record opens in "Recently opened".
   * Same pattern as ConsistencyPanel / ValueNamingPanel: the id the panel was
   * opened with is the truth. Reverse-resolving it from `cfg.serverUrl` picks
   * the wrong profile whenever two profiles share a URL (two v12 databases on
   * one gateway, or two v11 profiles differing only by user / CAM namespace),
   * and yields nothing at all while a profile is disconnected.
   */
  private static readonly serverIdByKey = new Map<string, string>();

  static initialize(extensionUri: vscode.Uri): void {
    this.host = new WebviewPanelHost<InMsg>('tm1.findReplace', 'Find/Replace');
    this.host.initialize(extensionUri);
  }

  /** Close the Find/Replace panel that belongs to the given server (on disconnect). */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  private static keyOf(cfg: Tm1Config): string {
    return `${cfg.serverUrl}::@${identityTag(cfg)}`;
  }

  static open(cfg: Tm1Config, serverId?: string, displayName?: string): void {
    if (!this.host) {
      throw new Error('FindReplacePanel not initialized');
    }
    // Key starts with serverUrl + `::` so the disconnect disposer (registered
    // with serverUrl) matches; the identity tag keeps a second profile on the
    // same URL from taking over this window. Refresh the cfg on every open —
    // including reveal.
    const key = FindReplacePanel.keyOf(cfg);
    this.cfgByKey.set(key, cfg);
    if (serverId) { this.serverIdByKey.set(key, serverId); }

    this.host.open({
      key,
      title: vscode.l10n.t('Find/Replace: {0}', displayName ?? serverId ?? cfg.serverUrl),
      html: (webview: vscode.Webview, extensionUri: vscode.Uri) => {
        const scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'findReplace.js'),
        );
        const l10n = buildFindReplaceL10n();
        return renderWebviewShell({
          cspSource: webview.cspSource,
          css: CSS,
          body: findReplaceBody(l10n),
          globals: { __l10n: l10n },
          scriptUris: [String(scriptUri)],
        });
      },
      onMessage: (msg: InMsg, panel: vscode.WebviewPanel) =>
        FindReplacePanel.onMessage(msg, panel, FindReplacePanel.cfgByKey.get(key) ?? cfg),
      onDispose: () => {
        FindReplacePanel.cfgByKey.delete(key);
        FindReplacePanel.serverIdByKey.delete(key);
      },
    });
  }

  private static async onMessage(
    msg: InMsg,
    panel: vscode.WebviewPanel,
    cfg: Tm1Config,
  ): Promise<void> {
    if (msg.type === 'open') {
      // Neither manager records a Recent entry itself — every caller does that,
      // so jumping to a match must record it just like opening from the tree.
      const serverId = FindReplacePanel.serverIdByKey.get(FindReplacePanel.keyOf(cfg));
      if (msg.objectKind === 'rule') {
        const { RuleEditorManager } = await import('../commands/rule/ruleEditor');
        await RuleEditorManager.open(msg.objectName, cfg, msg.line);
        recordRuleOpen(serverId, msg.objectName);
      } else {
        const { openProcess } = await import('../commands/processEditor/openPanel');
        const reveal = msg.unit && msg.line ? { section: msg.unit, line: msg.line } : undefined;
        await openProcess(msg.objectName, undefined, cfg, reveal);
        recordProcessOpen(serverId, msg.objectName);
      }
      return;
    }
    if (msg.type === 'search') {
      const { corpus, unreadable } = await fetchCorpus(cfg);
      const scoped = filterCorpus(corpus, msg.filter);
      const out: HostToWebview = { type: 'results', groups: runSearch(scoped, msg.query, msg.opts), unreadable };
      postTo<HostToWebview>(panel.webview, out);
    } else if (msg.type === 'replace') {
      // Bulk write to TM1 — confirm first, mirroring the Apply-all confirm in the
      // sibling Normalize / Unify tools (which never write without confirmation).
      const yes = vscode.l10n.t('Replace');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Replace across {0} selected match(es)? This writes to TM1.', String(msg.selected.length)),
        { modal: true },
        yes,
      );
      if (choice !== yes) { return; }
      // Re-fetch fresh — NEVER a cached search snapshot — so foreign changes made
      // between Search and Replace are not silently reverted. planReplace verifies
      // each selected id against the fresh corpus and drops (skips) those whose
      // source changed; surviving edits are rebuilt from the fresh text.
      const { corpus } = await fetchCorpus(cfg);
      const { edits, skipped } = planReplace(corpus, msg.selected, msg.replacement, msg.query, msg.opts);
      const report: ApplyReport = { ...(await applyEdits(cfg, edits)), skipped };
      const out: HostToWebview = { type: 'report', report };
      postTo<HostToWebview>(panel.webview, out);
    }
  }
}
