// src/webviews/tiConsoleWebview.ts
// TI console: run a TurboIntegrator snippet without leaving a process on
// the server. The run goes through the unbound endpoint
// `ExecuteProcessWithReturn` (`tm1Rest/transientProcess.ts`) — so nothing is
// created and nothing is deleted, not even on a cancel.
import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { escapeHtml } from '../utils/escapeHtml';
import { getInlineSignaturesJson } from '../utils/sigsAsset';
import { errMsg } from '../utils/errMsg';
import { runTransientProcess } from '../tm1Rest/transientProcess';
import { runCancellableProcess } from '../runState/runCancellableProcess';
import { buildTiConsoleL10n } from './tiConsoleL10n';
import { terminateTiSnippet, addTiHistory, type TiHistoryEntry } from './tiConsolePure';
import { keyedStore } from '../utils/keyedStore';
import {
  fetchCubeNames, fetchCubesWithDims, fetchDimensionNames, fetchHierarchyNamesFor,
  fetchProcessList,
} from '../providers/contextListFetch';
import { TI_CONSOLE_HISTORY_KEY } from '../serverState/stateKeys';
import type { L10nMap } from '../webviewClient/_shared/l10n';
import type { HostToWebview, WebviewToHost } from '../webviewClient/tiConsole/protocol';
import { postTo } from './typedPost';

/**
 * Not an object key — nothing is stored under this name. It
 * labels the run in the message log and sits in the file name of the
 * error log that `findLatestErrorLogFile` searches for afterwards.
 *
 * The suffix tells the windows of DIFFERENT machines apart. TM1 11.8 names
 * no `ErrorLogFile` for the `…WithReturn` family (see head of
 * `tm1Rest/transientProcess.ts`), so every failure goes through the
 * directory scan for `TM1ProcessError_<ts>_<pid>_<name>.log` — and `pid` is
 * the server PID, not a trait of the caller. With a fixed name the
 * second developer on the same instance had the first one's error log shown as "their"
 * result.
 *
 * Once per extension host, not per panel: two windows of the same machine
 * belong to the same person. The cancel search does not depend on the name (it
 * matches `ExecuteProcessWithReturn` plus its own session) and is left untouched.
 */
const TI_CONSOLE_PROC_NAME =
  `}VSCode_TIConsole_${Math.random().toString(36).slice(2, 8)}`;

/** History per server URL — blueprint `utils/keyedStore`, key in `stateKeys.ts`,
 * so that `purgeServerState` cleans it up when the profile is deleted. */
const historyStore = keyedStore<TiHistoryEntry[]>(TI_CONSOLE_HISTORY_KEY, {
  ctx: () => TiConsolePanel.memento,
  normalize: (v) => (Array.isArray(v) ? v : []),
});

const TI_CONSOLE_CSS = `
  html, body { height: 100%; }
  body {
    margin: 0; padding: 0;
    display: flex; flex-direction: column;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  /* Oben Editor + Verlauf nebeneinander, darunter die Werkzeugleiste mit
     „Run" — dieselbe Aufteilung wie der MDX Runner, damit beide Konsolen
     sich gleich bedienen lassen. */
  .top { display: flex; flex: 1 1 auto; min-height: 0; }
  .bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px;
    background: var(--vscode-editorWidget-background);
    border-top: 1px solid var(--vscode-panel-border);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex: 0 0 auto;
  }
  .bar .hint { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .bar #status { margin-left: auto; font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover:enabled { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }

  .history-pane { width: 260px; flex: 0 0 auto; display: flex; flex-direction: column;
    border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  .history-header { display: flex; align-items: center; justify-content: space-between;
    padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); }
  .history-header button { background: transparent; color: var(--vscode-descriptionForeground);
    border: none; cursor: pointer; font-size: 11px; padding: 1px 6px; border-radius: 2px; }
  .history-header button:hover:enabled { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  #history-list { flex: 1 1 auto; overflow: auto; }
  .history-empty { padding: 12px 8px; font-size: 11px; font-style: italic; text-align: center;
    color: var(--vscode-descriptionForeground); }
  .history-item { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border);
    cursor: pointer; font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-item .hi-code { font-family: var(--vscode-editor-font-family); color: var(--vscode-foreground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .history-item .hi-meta { display: flex; align-items: center; gap: 6px; font-size: 10px;
    color: var(--vscode-descriptionForeground); }
  .history-item .hi-meta .hi-spacer { margin-left: auto; }
  .history-item .hi-meta button { background: transparent; border: none; padding: 0 4px;
    color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 12px; opacity: 0; }
  .history-item:hover .hi-meta button { opacity: 0.7; }
  .history-item .hi-meta button:hover { opacity: 1; color: var(--vscode-foreground); }
  .history-item .hi-meta .hi-delete:hover { color: var(--vscode-errorForeground); }
  .history-item.error .hi-meta { color: var(--vscode-errorForeground); }
  .history-item.error .hi-code { opacity: 0.75; }
  button {
    font-family: inherit; font-size: 13px;
    padding: 4px 14px; border: none; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button:hover:enabled { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  /* min-height:0 is mandatory: without it a flex child grows to its content
     and the editor pushes the output out of the window instead of scrolling itself. */
  #ti-editor { flex: 1 1 auto; min-width: 0; }
  #ti-out {
    flex: 0 0 auto; min-height: 0; max-height: 40%; overflow: auto;
    margin: 0; padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    font-family: var(--vscode-editor-font-family);
    font-size: 12px; white-space: pre-wrap;
  }
  .out-ok  { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  .out-err { color: var(--vscode-errorForeground); }
  .out-plain { opacity: 0.8; }
`;

function tiConsoleBody(l10n: L10nMap): string {
  return `
  <div class="top">
    <div id="ti-editor"></div>
    <aside class="history-pane">
      <div class="history-header">
        <span>${escapeHtml(l10n.history)}</span>
        <button id="history-clear" title="${escapeHtml(l10n.clearAllTitle)}">${escapeHtml(l10n.clearAll)}</button>
      </div>
      <div id="history-list"></div>
    </aside>
  </div>
  <div class="bar">
    <button id="btn-run">${escapeHtml(l10n.run)}</button>
    <button id="btn-clear" class="secondary" title="${escapeHtml(l10n.clearEditorTitle)}">${escapeHtml(l10n.clearEditor)}</button>
    <span class="hint">${escapeHtml(l10n.hint)}</span>
    <span id="status"></span>
  </div>
  <pre id="ti-out" class="out-plain"></pre>`;
}

export class TiConsolePanel {
  private static host: WebviewPanelHost<WebviewToHost>;
  /**
   * Current `Tm1Config` per panel. The `onMessage` closure is wired only on the
   * FIRST `open()` (afterwards `reveal` returns early), so it
   * reads the configuration from here instead of capturing it — otherwise REST would keep running
   * with the first one after a reconnect.
   */
  private static readonly cfgByKey = new Map<string, Tm1Config>();

  /** For `historyStore` — the store is built at module time, the context
   * is only fixed with activation. */
  static memento: vscode.ExtensionContext | undefined;

  static initialize(context: vscode.ExtensionContext): void {
    this.memento = context;
    this.host = new WebviewPanelHost<WebviewToHost>('tm1.tiConsole', 'TI Console');
    this.host.initialize(context.extensionUri);
  }

  static disposeAll(): void {
    this.host?.disposeAll();
  }

  /** Close the console of this server (on disconnect). */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cfg: Tm1Config, serverId: string, displayName?: string): void {
    if (!this.host) { throw new Error('TiConsolePanel not initialized'); }
    // The key carries the server URL FIRST — exactly the form that
    // `disposePanelsForServer` finds on disconnect — and the profile behind it.
    // The bare URL was not enough: two profiles on the same instance with
    // different users would otherwise share panel AND entry in
    // `cfgByKey`. The second `open()` returns early on `reveal`, but has already
    // overwritten the configuration — the next run in the window
    // of A would run with the rights of B, while the title names A.
    const key = `${cfg.serverUrl}::ti#${serverId}`;
    this.cfgByKey.set(key, cfg);

    this.host.open({
      key,
      title: vscode.l10n.t('TI Console: {0}', displayName ?? cfg.serverUrl),
      html: (webview, extensionUri) => {
        const uri = (...parts: string[]): string =>
          String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', ...parts)));
        const l10n = buildTiConsoleL10n();
        return renderWebviewShell({
          cspSource: webview.cspSource,
          title: 'TM1 TI Console',
          styleUris: [uri('monaco-vendor.css')],
          css: TI_CONSOLE_CSS,
          body: tiConsoleBody(l10n),
          // `__v12` controls the suggestion list: the HTTP and job family
          // exist only from v12, on 11.x the compiler acknowledges them with
          // an error that the suggestion itself caused.
          // `__tm1DocLang` controls the language of the generated IBM doc links.
          globals: { __l10n: l10n, __v12: cfg.version === 'v12', __tm1DocLang: vscode.env.language },
          // The function list is embedded, not bundled along — `sigsBootstrap`
          // in the client reads exactly this block and fills `KNOWN_SIGNATURES`.
          jsonData: [{ id: 'tm1-signatures-data', json: getInlineSignaturesJson(extensionUri) }],
          scriptUris: [uri('monaco-vendor.js'), uri('tiConsole.js')],
        });
      },
      onMessage: (msg, panel) =>
        TiConsolePanel.onMessage(msg, panel, TiConsolePanel.cfgByKey.get(key) ?? cfg),
      // `historyUpdate` must come after the handshake: until `webviewReady`
      // the listener in the client is not yet there.
      onDispose: () => { TiConsolePanel.cfgByKey.delete(key); },
    });
  }

  private static async onMessage(
    msg: WebviewToHost,
    panel: vscode.WebviewPanel,
    cfg: Tm1Config,
  ): Promise<void> {
    const post = (out: HostToWebview): void => { void postTo<HostToWebview>(panel.webview, out); };
    const ops = (): ReturnType<typeof historyStore.withCtx> | undefined =>
      TiConsolePanel.memento ? historyStore.withCtx(TiConsolePanel.memento) : undefined;
    const load = (): TiHistoryEntry[] => ops()?.load(cfg.serverUrl) ?? [];
    const store = async (entries: TiHistoryEntry[]): Promise<void> => {
      await ops()?.save(cfg.serverUrl, entries);
      post({ type: 'historyUpdate', entries });
    };

    if (msg.type === 'webviewReady') { post({ type: 'historyUpdate', entries: load() }); return; }

    // Clipboard: the webview may not read or write it, the host may.
    if (msg.type === 'requestPaste') {
      let text = '';
      try { text = await vscode.env.clipboard.readText(); } catch { /* not available */ }
      post({ type: 'pasteText', text });
      return;
    }
    if (msg.type === 'requestCopy') {
      try { await vscode.env.clipboard.writeText(msg.text); } catch { /* not available */ }
      return;
    }

    // Server objects for the completion. A failure returns the
    // empty list instead of nothing at all: otherwise the client waits forever for
    // its answer and the suggestion list stays absent on every further attempt.
    if (msg.type === 'fetchCubes') {
      post({ type: 'cubeList', cubes: await fetchCubeNames(cfg) });
      return;
    }
    if (msg.type === 'fetchDimensions') {
      post({ type: 'dimensionList', dimensions: await fetchDimensionNames(cfg) });
      return;
    }
    if (msg.type === 'fetchProcesses') {
      post({ type: 'processList', processes: await fetchProcessList(cfg) });
      return;
    }
    if (msg.type === 'fetchHierarchies') {
      post({
        type: 'hierarchyList', dimension: msg.dimension,
        hierarchies: await fetchHierarchyNamesFor(cfg, msg.dimension),
      });
      return;
    }
    if (msg.type === 'fetchCubesWithDims') {
      post({ type: 'cubesWithDims', cubes: await fetchCubesWithDims(cfg) });
      return;
    }
    if (msg.type === 'clearHistory') { await store([]); return; }
    if (msg.type === 'deleteHistoryEntry') {
      // Via the TIMESTAMP, not via the position: the history is stored per
      // server URL, but the panel per profile. Two profiles on the
      // same instance thus have two windows on ONE list, and
      // `historyUpdate` goes only to the writing one. The sister window
      // then showed an outdated list — and a click on "delete" there hit
      // a different entry via the index than the one displayed.
      //
      // What remains: the outdated DISPLAY, until the window itself writes
      // or reopens. It shows too much or too little, but no longer deletes anything
      // wrong.
      const entries = load();
      const rest = entries.filter(e => e.timestamp !== msg.timestamp);
      if (rest.length === entries.length) { return; }
      await store(rest);
      return;
    }
    if (msg.type !== 'run') { return; }
    const started = Date.now();
    try {
      // `includeTransient`: the run carries no object name, the
      // cancel search recognizes it only by the function `ExecuteProcessWithReturn`.
      const { result, cancelled } = await runCancellableProcess(
        vscode.l10n.t('TI Console'),
        TI_CONSOLE_PROC_NAME,
        cfg,
        () => runTransientProcess(cfg, { name: TI_CONSOLE_PROC_NAME, prolog: terminateTiSnippet(msg.code) }),
        { includeTransient: true },
      );
      if (cancelled || !result) { post({ type: 'cancelled' }); return; }
      const elapsedMs = Date.now() - started;
      post({ ...result, type: 'result', elapsedMs });
      await store(addTiHistory(load(), {
        code: msg.code, timestamp: Date.now(), elapsedMs, ok: result.ok, status: result.status,
      }));
    } catch (e) {
      // Not thrown because the process reported errors — that would be a
      // `result`. Here TM1 never got to executing at all:
      // compile error, 401, network gone.
      const message = errMsg(e);
      post({ type: 'failed', message });
      // The failure belongs in the history too: the snippet that did not
      // compile is one you want to open again right away and fix.
      await store(addTiHistory(load(), {
        code: msg.code, timestamp: Date.now(), elapsedMs: Date.now() - started, ok: false, status: message,
      }));
    }
  }
}
