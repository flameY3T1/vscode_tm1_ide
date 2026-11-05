import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import { apiRequest } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import {
  getCubeRules, updateCubeRules,
  getCubeDimensionNames, listCubes,
} from '../../tm1Rest/cubeApi';
import { getRuleEditorMonacoHtml } from './ruleEditorMonacoWebview';
import { isV12Active } from '../../utils/v12Mode';
import { lintRules, lintRulesServer } from '../../tiLogicVisualizer/rulesLinter';
import { localizeLintDiagnostics } from '../../providers/lintLocalize';
import { fetchNames } from '../../providers/fetchNames';
import { qualifyElements } from '../../elementQualifier/qualifyElements';
import { buildCubeElementIndex, invalidateCubeIndex } from '../../elementQualifier/cubeElementIndex';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { loadRuleFormatConfig, saveRuleFormatConfig } from '../../providers/ruleFormatConfigStore';
import { loadRulesLintConfig, saveRulesLintConfig } from './rulesLintConfigStore';
import { applyRulesLintConfig, type RulesLintConfig } from '../../tiLogicVisualizer/rulesLinter/ruleConfig';
import type { RuleFormatConfig } from '../../tiLogicVisualizer/formatRulesText';
import { listElementAttributeNames } from '../../tm1Rest/dimensionApi';
import { openAreaDbBuilder } from './areaDbBuilder';
import { parkRuleDraft, offerRuleDraftRecovery, clearRuleDraft } from './ruleDraftStore';
import { errMsg } from '../../utils/errMsg';
import { registerWindow, unregisterWindow } from '../../workbench/windowRegistry';
import type {
  HostToWebview,
  WebviewToHost,
} from '../../webviewClient/ruleEditorMonaco/protocol';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

export async function fetchRules(cubeName: string, config: Tm1Config): Promise<string> {
  try {
    return await getCubeRules(config, cubeName);
  } catch (err) {
    if (/HTTP 404/.test(errMsg(err))) { return ''; }
    throw err;
  }
}

export async function saveRules(cubeName: string, rulesText: string, config: Tm1Config): Promise<void> {
  await updateCubeRules(config, cubeName, rulesText, vscode.l10n.t('Failed to save rules'));
}

export class RuleEditorManager {
  private static _panels = new Map<string, vscode.WebviewPanel>();
  private static _extensionUri: vscode.Uri | undefined;
  private static _context: vscode.ExtensionContext | undefined;

  static initialize(extensionUri: vscode.Uri, context?: vscode.ExtensionContext): void {
    this._extensionUri = extensionUri;
    // Optional: without it, draft recovery is simply off (as in unit tests).
    if (context) { this._context = context; }
  }

  /** The focused rule editor, or null. Used by the public `tm1.editor.insertText`. */
  static getActivePanel(): vscode.WebviewPanel | null {
    for (const p of this._panels.values()) {
      if (p.active) { return p; }
    }
    return null;
  }

  /** Push a (just-imported) rules-format config to every open rule editor on the
   *  given server, so their format menu reflects the change live. */
  static broadcastRuleFormatConfig(serverKey: string, config: RuleFormatConfig): void {
    const prefix = `${serverKey}:`;
    for (const [key, panel] of this._panels) {
      if (key.startsWith(prefix)) {
        postTo<HostToWebview>(panel.webview, { type: 'formatConfig', config });
      }
    }
  }

  /** Same for the rules-lint config, so a change in one editor reaches the others
   *  on that server instead of leaving them on a stale rule set. */
  static broadcastRulesLintConfig(serverKey: string, config: RulesLintConfig): void {
    const prefix = `${serverKey}:`;
    for (const [key, panel] of this._panels) {
      if (key.startsWith(prefix)) {
        postTo<HostToWebview>(panel.webview, { type: 'rulesLintConfig', config });
      }
    }
  }

  static async open(cubeName: string, config: Tm1Config, revealLine?: number, onSaved?: () => void): Promise<void> {
    if (!this._extensionUri) {
      throw new Error('RuleEditorManager.initialize(extensionUri) must be called before open()');
    }
    const serverKey = config?.serverUrl ?? '__default__';
    // Identity tag: two profiles on one URL must not share a panel (see identityTag).
    const panelKey = `${serverKey}:@${identityTag(config)}:${cubeName}`;
    // Parked drafts are persisted: keep their key on the URL (instance), as before.
    const draftKey = `${serverKey}:${cubeName}`;
    const existing = this._panels.get(panelKey);
    if (existing) {
      // Without a column argument, the panel stays in its own column.
      existing.reveal();
      if (revealLine) {
        postTo<HostToWebview>(existing.webview, { type: 'revealLine', line: revealLine });
      }
      return;
    }

    const extensionUri = this._extensionUri;
    const serverLabel = formatServerLabel(config?.serverUrl, getServerNameByUrl);
    const panelTitle = serverLabel ? `${serverLabel} : ${cubeName} — Rules` : `${cubeName} — Rules`;
    const panel = vscode.window.createWebviewPanel(
      'tm1RuleEditor',
      panelTitle,
      // A symbolic column: opens in the active group, and therefore in the
      // same window as the triggering click (for example from a Cell Trace
      // panel in a detached window).
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'out', 'webview'),
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );
    setPanelIcon(panel, 'tm1RuleEditor');
    muteWebviewOnDispose(panel);

    this._panels.set(panelKey, panel);
    registerWindow({
      kind: 'tm1RuleEditor', rawKey: panelKey, panel,
      serverId: config.serverUrl, target: cubeName,
    });

    // A webview panel close cannot be intercepted — onDidDispose runs when the
    // panel is already gone. The host therefore tracks dirtiness itself (the
    // webview posts `codeChanged` with the full text on every user edit) and
    // parks the last known text so the next open can offer it back.
    let dirty = false;
    const draftMemento = RuleEditorManager._context?.globalState;
    panel.onDidDispose(() => {
      unregisterWindow(panel);
      this._panels.delete(panelKey);
      void parkRuleDraft(draftMemento, draftKey, cubeName, latestCode, dirty, Date.now());
    });
    panel.webview.html = getRuleEditorMonacoHtml(panel.webview, extensionUri, isV12Active(config));

    const boundApi = (method: string, path: string) => apiRequest(method, path, undefined, undefined, config);

    // Fetch rules up-front; initData is sent only after the webview signals `monacoReady`.
    let rulesText = '';
    let initialLintDiags: ReturnType<typeof lintRules> = [];
    let cubeDimensions: string[] = [];

    // Init handshake to fix the intermittent EMPTY rule editor: a fast webload
    // could fire `monacoReady` before the awaited fetch finished. The message
    // listener is now attached SYNCHRONOUSLY (below, before the fetch) so the
    // signal is never dropped; sendRuleInitData() pushes the payload once BOTH
    // sides are ready (webview signalled monacoReady AND data has loaded).
    let rulesReady = false;
    let rulesDataLoaded = false;
    let rulesInitSent = false;
    const sendRuleInitData = (): void => {
      if (rulesInitSent || !rulesReady || !rulesDataLoaded) { return; }
      rulesInitSent = true;
      postTo<HostToWebview>(panel.webview, { type: 'initData', cubeName, rulesText, lintDiags: initialLintDiags, cubeDimensions });
      if (revealLine) {
        postTo<HostToWebview>(panel.webview, { type: 'revealLine', line: revealLine });
      }
      postTo<HostToWebview>(panel.webview, { type: 'formatConfig', config: loadRuleFormatConfig(serverKey) });
      postTo<HostToWebview>(panel.webview, { type: 'rulesLintConfig', config: loadRulesLintConfig(serverKey) });
      // Server-side lint runs once after load
      lintRulesServer(rulesText, boundApi).then(serverDiags => {
        if (serverDiags.length > 0) {
          postTo<HostToWebview>(panel.webview, {
            type: 'lintResults',
            diagnostics: localizeLintDiagnostics([...initialLintDiags, ...serverDiags]),
          });
        }
      }).catch(() => { /* no server connection */ });
    };

    // Debounce state for server-side lint on typing
    let serverLintTimer: ReturnType<typeof setTimeout> | undefined;
    let latestCode = '';
    // Otherwise a lint debounce for text that was typed but never committed
    // would still fire a REST call against an already-disposed panel after
    // closing.
    panel.onDidDispose(() => clearTimeout(serverLintTimer));

    // Single message listener, attached BEFORE the awaited fetch below so an
    // early `monacoReady` is never lost.
    panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      if (!msg || !msg.type) { return; }

      switch (msg.type) {
        case 'openExternal': {
          if (typeof msg.url === 'string' && /^https?:\/\//i.test(msg.url)) {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
        }

        case 'monacoReady': {
          // Deferred init: mark ready and send once the fetch below has stored
          // data (sendRuleInitData is a no-op until both conditions hold).
          // Reset the sent-flag so a webview reload/eviction (which re-fires
          // monacoReady WITHOUT disposing the panel) re-hydrates the editor
          // instead of staying blank.
          rulesReady = true;
          rulesInitSent = false;
          sendRuleInitData();
          break;
        }

        case 'getCompletions': {
          try {
            if (msg.context === 'dimensions') {
              const names = await fetchNames('Dimensions', config);
              postTo<HostToWebview>(panel.webview, { type: 'completions', context: 'dimensions', items: names });
            } else if (msg.context === 'cubes') {
              const names = await fetchNames('Cubes', config);
              postTo<HostToWebview>(panel.webview, { type: 'completions', context: 'cubes', items: names });
            } else if (msg.context === 'cubesWithDims') {
              const items = await listCubes(config, { select: 'Name', top: 10000, expand: 'Dimensions($select=Name)' }).catch(() => [] as any[]);
              const cubes: Array<{ name: string; dims: string[] }> = items.map(c => ({
                name: String(c.Name),
                dims: ((c.Dimensions ?? []) as any[]).map(d => String(d.Name)),
              }));
              postTo<HostToWebview>(panel.webview, { type: 'completions', context: 'cubesWithDims', cubes });
            } else if (msg.context === 'attributes' && msg.dimension) {
              const items = await listElementAttributeNames(config, msg.dimension as string);
              postTo<HostToWebview>(panel.webview, { type: 'completions', context: 'attributes', dimension: msg.dimension, items });
            }
          } catch { /* no server connection */ }
          break;
        }

        case 'requestPaste': {
          try {
            const text = await vscode.env.clipboard.readText();
            postTo<HostToWebview>(panel.webview, { type: 'pasteText', text });
          } catch {
            postTo<HostToWebview>(panel.webview, { type: 'pasteText', text: '' });
          }
          break;
        }

        case 'requestCopy': {
          try { await vscode.env.clipboard.writeText(typeof msg.text === 'string' ? msg.text : ''); }
          catch { /* clipboard write unavailable */ }
          break;
        }

        case 'save': {
          try {
            const text = msg.rulesText as string;
            // Through the config filter: a rule the user switched off must not
            // block saving either.
            const errorCount = applyRulesLintConfig(lintRules(text), loadRulesLintConfig(serverKey))
              .filter(d => d.severity === 'error').length;
            if (errorCount > 0) {
              const choice = await vscode.window.showWarningMessage(
                vscode.l10n.t('Linter reports {0} error(s). Save anyway?', errorCount),
                { modal: true },
                vscode.l10n.t('Save anyway'),
              );
              if (choice !== vscode.l10n.t('Save anyway')) {
                postTo<HostToWebview>(panel.webview, { type: 'saveCancelled' });
                break;
              }
            }
            // Server-side pre-validate via tm1.CheckRules. Unlike processes, this
            // accepts the new payload — no deploy-then-revert needed.
            if (config) {
              try {
                const { checkRules } = await import('../../tm1Rest/rulesCompile');
                const errors = await checkRules(cubeName, text, config);
                if (errors && errors.length > 0) {
                  const compileDiags = errors.map(err => ({
                    ruleId: 'tm1-compile',
                    severity: 'error' as const,
                    message: `[compile] ${err.Message}`,
                    line: Math.max(0, (err.LineNumber ?? 1) - 1),
                  }));
                  postTo<HostToWebview>(panel.webview, { type: 'compileResults', diagnostics: compileDiags });
                  postTo<HostToWebview>(panel.webview, { type: 'saveError', message: vscode.l10n.t('Compile error — not saved ({0}).', errors.length) });
                  vscode.window.showErrorMessage(vscode.l10n.t('Compile error — not saved ({0}).', errors.length));
                  break;
                }
              } catch (checkErr) {
                // CheckRules unreachable. Saving anyway is the lesser evil — refusing
                // would block every save whenever the endpoint is missing — but the
                // save must not look pre-validated when nothing validated it.
                vscode.window.showWarningMessage(vscode.l10n.t('Rules were saved without the server check: {0}.', errMsg(checkErr)));
              }
            }
            await saveRules(cubeName, text, config);
            if (config) {
              const { mirrorRulesAfterSave } = await import('../git/mirror');
              void mirrorRulesAfterSave(cubeName, text, config);
            }
            postTo<HostToWebview>(panel.webview, { type: 'clearCompileResults' });
            postTo<HostToWebview>(panel.webview, { type: 'saveSuccess' });
            dirty = false;
            // TM1 holds this text now — a parked draft would offer stale work.
            if (draftMemento) {
              void clearRuleDraft(draftMemento, draftKey).then(undefined, () => { /* best effort */ });
            }
            // Rules text changed on the server — a cube may have gained/lost its
            // Rules node; let the caller evict any has-rules cache + refresh tree.
            onSaved?.();
          } catch (err) {
            postTo<HostToWebview>(panel.webview, { type: 'saveError', message: errMsg(err) });
          }
          break;
        }

        case 'qualifyElements': {
          try {
            const idx = await buildCubeElementIndex(cubeName, serverKey, boundApi);
            const result = qualifyElements(msg.code as string, idx);
            postTo<HostToWebview>(panel.webview, {
              type: 'qualifyResult',
              ok: true,
              text: result.text,
              warnings: result.warnings,
            });
          } catch (err) {
            invalidateCubeIndex(cubeName, serverKey);
            postTo<HostToWebview>(panel.webview, {
              type: 'qualifyResult',
              ok: false,
              message: errMsg(err),
            });
          }
          break;
        }

        case 'setFormatConfig': {
          await saveRuleFormatConfig(serverKey, msg.config);
          postTo<HostToWebview>(panel.webview, { type: 'formatConfig', config: msg.config });
          break;
        }

        case 'setRulesLintConfig': {
          await saveRulesLintConfig(serverKey, msg.config);
          postTo<HostToWebview>(panel.webview, { type: 'rulesLintConfig', config: msg.config });
          // Re-lint at once: switching a rule off should clear its squiggles without
          // waiting for the next keystroke.
          const relinted = applyRulesLintConfig(lintRules(latestCode), msg.config);
          postTo<HostToWebview>(panel.webview, { type: 'lintResults', diagnostics: localizeLintDiagnostics(relinted) });
          break;
        }

        case 'codeChanged': {
          const code = msg.code as string;
          latestCode = code;
          // The webview only posts this for USER edits, so it is exactly the
          // dirty signal — the host had none of its own before.
          dirty = true;

          const syncDiags = applyRulesLintConfig(lintRules(code), loadRulesLintConfig(serverKey));
          postTo<HostToWebview>(panel.webview, { type: 'lintResults', diagnostics: localizeLintDiagnostics(syncDiags) });

          clearTimeout(serverLintTimer);
          serverLintTimer = setTimeout(() => {
            const codeAtTimeout = latestCode;
            lintRulesServer(codeAtTimeout, boundApi).then(serverDiags => {
              if (!panel.visible) { return; }
              const all = applyRulesLintConfig(
                [...lintRules(codeAtTimeout), ...serverDiags],
                loadRulesLintConfig(serverKey),
              );
              postTo<HostToWebview>(panel.webview, { type: 'lintResults', diagnostics: localizeLintDiagnostics(all) });
            }).catch(() => { /* no server connection */ });
          }, 1200);
          break;
        }

        case 'openAreaDbBuilder': {
          openAreaDbBuilder({
            extensionUri,
            config,
            currentCube: cubeName,
            onInsert: (text) => post(panel, { type: 'pasteText', text }),
          });
          break;
        }
      }
    });

    // Fetch rules AFTER the listener is attached; initData is sent from
    // sendRuleInitData() once both the fetch has completed and `monacoReady`
    // has arrived (order-independent).
    try {
      rulesText = await fetchRules(cubeName, config);

      // A previous panel was closed with unsaved rules: offer them back before
      // the server version reaches the webview. Declining discards the draft,
      // otherwise the prompt would return on every future open.
      const recovered = await offerRuleDraftRecovery(draftMemento, draftKey, cubeName);
      if (recovered !== undefined) {
        rulesText = recovered;
        // Restored text differs from the server, so the panel starts dirty —
        // closing it again must park it rather than drop it.
        dirty = true;
        latestCode = recovered;
      }

      initialLintDiags = applyRulesLintConfig(lintRules(rulesText), loadRulesLintConfig(serverKey));

      try {
        cubeDimensions = await getCubeDimensionNames(config, cubeName);
      } catch { /* no server connection */ }

      rulesDataLoaded = true;
      latestCode = rulesText;
      sendRuleInitData();
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load TM1 rules: {0}', errMsg(err)));
      panel.dispose();
      return;
    }
  }

  /**
   * Close the rule editor of one cube — call this after the cube was deleted.
   *
   * The panel keeps the rules text it loaded when it opened. Left open, a Save
   * writes that text to `Cubes('<name>')`; recreate a cube under the same name
   * and the write succeeds, silently replacing the new rules with the old ones
   * and mirroring them to git. Closing the panel is the only thing that ties its
   * lifetime to the object it edits.
   */
  static disposePanelForCube(cubeName: string, serverUrl: string): void {
    if (!serverUrl || !cubeName) { return; }
    // Every identity's panel on that cube: key = `${serverUrl}:@<tag>:${cubeName}`.
    // TM1 object names cannot contain `:`, so the suffix pins the cube exactly.
    const head = `${serverUrl}:@`;
    for (const [key, panel] of [...this._panels]) {
      if (key.startsWith(head) && key.endsWith(`:${cubeName}`)) { panel.dispose(); }
    }
  }

  /** Close every rule-editor panel that belongs to the given server. */
  static disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    const prefix = `${serverUrl}:`;
    const toClose: vscode.WebviewPanel[] = [];
    for (const [key, panel] of this._panels) {
      if (key.startsWith(prefix)) { toClose.push(panel); }
    }
    for (const p of toClose) { p.dispose(); }
  }
}

registerServerDisposer('ruleEditor', (url) => RuleEditorManager.disposePanelsForServer(url));
