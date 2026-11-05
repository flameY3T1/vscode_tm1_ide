import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import { apiRequest, Tm1Config } from '../../tm1Client';
import { withSandbox } from '../../tm1Rest/sandboxTracker';
import {
  executeMdx, executeMdxContinue, abortMdxCellset, ApiFetcher,
} from '../../mdx/executeMdx';
import { handleMdxMessage, MdxHandlerDeps } from '../../mdx/messageHandler';
import { addEntry, removeEntry, HistoryEntry } from '../../mdx/historyStore';
import { getMdxRunnerHtml } from './mdxRunnerWebview';
import type { HostToWebview, WebviewToHost, MdxOutMessage } from '../../webviewClient/mdxRunnerMonaco/protocol';
import {
  getCubes as schemaGetCubes,
  getCubeDims as schemaGetCubeDims,
  getDimElements as schemaGetDimElements,
  getElementNames as schemaGetElementNames,
  clearSessionElements,
} from '../../mdx/mdxSchemaCache';
import { registerWindow, unregisterWindow } from '../../workbench/windowRegistry';
import { keyedStore } from '../../utils/keyedStore';
import { rememberColumnWidths } from '../../webviews/columnWidthStore';
import { MDX_HISTORY_KEY } from '../../serverState/stateKeys';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';

/** Built on `utils/keyedStore` — the context arrives on open.
 *  The key lives in `serverState/stateKeys.ts`, so that
 *  `purgeServerState` also clears the history of a deleted profile. */
const historyStore = keyedStore<HistoryEntry[]>(MDX_HISTORY_KEY, {
  ctx: () => undefined,
  normalize: (v) => (Array.isArray(v) ? v : []),
});

export class MdxRunnerManager {
  private static readonly _panels = new Map<string, vscode.WebviewPanel>();
  private static _context: vscode.ExtensionContext | null = null;
  /** Latest "Open in MDX Runner" prefill per panel — stashed so a
   *  `webviewReady` handshake can resend it if Monaco was still cold-starting
   *  when the eager post fired. Keyed by the panel instance itself (WeakMap)
   *  so a later panel reused under the same server key can never read a
   *  previous panel's stale entry — a new panel is a new object, so lookup
   *  by construction misses. Also GC's on its own; no manual delete needed
   *  (P1-8 review). */
  private static readonly _pendingMdx = new WeakMap<vscode.WebviewPanel, string>();

  /** Stash the context so call sites that don't carry it (e.g. webview message
   *  handlers in dimensionBrowser / cubeViewer) can still open the runner via
   *  {@link openWithMdx}. */
  static initialize(context: vscode.ExtensionContext): void {
    MdxRunnerManager._context = context;
  }

  /**
   * Open the MDX runner panel and prefill the editor with the provided MDX.
   * Convenience wrapper around {@link open} for "Open in MDX Runner" buttons
   * from other panels. Uses the context stored via {@link initialize}.
   */
  static openWithMdx(serverCfg: Tm1Config, serverLabel: string, mdx: string): void {
    if (!MdxRunnerManager._context) {
      vscode.window.showWarningMessage(vscode.l10n.t('TM1: MdxRunnerManager not initialized.'));
      return;
    }
    const serverId = serverLabel || serverCfg.serverUrl;
    MdxRunnerManager.open(MdxRunnerManager._context, serverId, serverCfg, serverLabel);
    const key = `${serverId}|${serverCfg.serverUrl}`;
    const panel = MdxRunnerManager._panels.get(key);
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active);
      // Stash for the webviewReady handshake (safety net if Monaco is still
      // cold-starting), then post eagerly — mirrors cubeViewer's initData pattern.
      MdxRunnerManager._pendingMdx.set(panel, mdx);
      const loadMdxMsg: HostToWebview = { type: 'loadMdx', mdx };
      postTo<HostToWebview>(panel.webview, loadMdxMsg);
    }
  }

  static open(
    context: vscode.ExtensionContext,
    serverId: string,
    serverCfg: Tm1Config,
    serverLabel: string,
  ): void {
    const key = `${serverId}|${serverCfg.serverUrl}`;
    const existing = MdxRunnerManager._panels.get(key);
    if (existing) { existing.reveal(vscode.ViewColumn.Active); return; }

    const panel = vscode.window.createWebviewPanel(
      'tm1MdxRunner',
      `MDX Runner: ${serverLabel}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
      },
    );
    setPanelIcon(panel, 'tm1MdxRunner');
    muteWebviewOnDispose(panel);
    MdxRunnerManager._panels.set(key, panel);
    registerWindow({ kind: 'tm1MdxRunner', rawKey: key, panel, serverId });
    // Captured below; disposed on panel close so the listener is scoped to the
    // panel instead of accumulating in context.subscriptions across reopens (F4).
    // eslint-disable-next-line prefer-const -- captured by the onDidDispose closure below, assigned after.
    let msgSub: vscode.Disposable | undefined;
    // Disposing msgSub stops new messages, not a handler already awaiting a run.
    let disposed = false;
    panel.onDidDispose(() => {
      disposed = true;
      unregisterWindow(panel);
      msgSub?.dispose();
      MdxRunnerManager._panels.delete(key);
      // No _pendingMdx cleanup needed: it's a WeakMap<panel, string>, so this
      // panel's entry is unreachable (and GC-eligible) once nothing else
      // references the panel, and msgSub.dispose() above means webviewReady
      // can never be handled for it again anyway.
      // Drop only this server's element-set cache so closing one panel does
      // not wipe caches in use by another panel on a different server.
      clearSessionElements(serverCfg.serverUrl);
    });

    panel.webview.html = getMdxRunnerHtml(panel.webview, context.extensionUri, serverLabel);
    rememberColumnWidths(panel, 'mdxRunner');

    const serverUrl = serverCfg.serverUrl;
    const loadHistory = (): HistoryEntry[] => historyStore.withCtx(context).load(serverUrl);
    const saveHistory = (entries: HistoryEntry[]): Thenable<void> =>
      historyStore.withCtx(context).save(serverUrl, entries);
    const postHistory = (entries: HistoryEntry[]): void => {
      const historyMsg: HostToWebview = { type: 'historyUpdate', entries };
      postTo<HostToWebview>(panel.webview, historyMsg);
    };

    let history = loadHistory();
    // Post eagerly once computed; webviewReady below resends it as a safety
    // net if the client's listener wasn't registered yet (mirrors cubeViewer).
    postHistory(history);

    const api: ApiFetcher = (method, path, body) =>
      apiRequest(method, path, body, undefined, serverCfg, withSandbox(serverCfg));

    const deps: MdxHandlerDeps = {
      execute: (mdx) => executeMdx(mdx, api),
      continueExecute: (cellsetId) => executeMdxContinue(cellsetId, api),
      abortCellset: (cellsetId) => abortMdxCellset(cellsetId, api),
      readClipboard: () => Promise.resolve(vscode.env.clipboard.readText()),
      writeClipboard: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
      getCubes: () => schemaGetCubes(serverCfg, api),
      getCubeDims: (cube) => schemaGetCubeDims(cube, serverCfg, api),
      getDimElements: (dim, hier) => schemaGetDimElements(dim, serverCfg, api, hier),
      getElementNames: (dim, hier) => schemaGetElementNames(dim, serverCfg, api, hier),
    };

    msgSub = panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      if (msg.type === 'webviewReady') {
        // Handshake safety net: resend whatever was posted eagerly above, in
        // case the client's message listener wasn't registered yet (P1-8).
        postHistory(history);
        const pending = MdxRunnerManager._pendingMdx.get(panel);
        if (pending !== undefined) {
          const loadMdxMsg: HostToWebview = { type: 'loadMdx', mdx: pending };
          postTo<HostToWebview>(panel.webview, loadMdxMsg);
        }
        return;
      }
      if (msg.type === 'openExternal') {
        const url = msg.url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        return;
      }
      if (msg.type === 'deleteHistoryEntry') {
        history = removeEntry(history, msg.index);
        await saveHistory(history);
        postHistory(history);
        return;
      }
      if (msg.type === 'clearHistory') {
        history = [];
        await saveHistory(history);
        postHistory(history);
        return;
      }

      const originalMdx = msg.type === 'execute' ? msg.mdx : '';
      const out = await handleMdxMessage(msg, deps);

      // Localize pure-module error messages that carry a stable code (the
      // mdx/executeMdx module is vscode-free and emits English source strings).
      if (out && out.type === 'result' && out.ok === false && out.error.code === 'bare-set') {
        out.error.message = vscode.l10n.t('Set expression — could not determine dimension/hierarchy.');
      }

      // cellCountWarning → show modal, route user decision back to handler.
      if (out && out.type === 'cellCountWarning') {
        if (disposed) {
          await handleMdxMessage({ type: 'abort', cellsetId: out.cellsetId }, deps);
          return;
        }
        const action = await vscode.window.showWarningMessage(
          vscode.l10n.t('Result has {0} cells (limit {1}). Load in full?', out.cellCount.toLocaleString(), out.limit.toLocaleString()),
          { modal: true },
          vscode.l10n.t('Load'),
          vscode.l10n.t('Cancel'),
        );
        if (action === vscode.l10n.t('Load')) {
          const cont = await handleMdxMessage({ type: 'continueLoad', cellsetId: out.cellsetId }, deps);
          if (cont) { postTo<HostToWebview>(panel.webview, cont); }
          if (cont && cont.type === 'result' && cont.ok && originalMdx.trim() !== '') {
            history = addEntry(history, {
              mdx: originalMdx,
              timestamp: Date.now(),
              elapsedMs: cont.elapsedMs,
              rowCount: cont.table.dims.rows,
              colCount: cont.table.dims.cols,
            });
            saveHistory(history).then(() => postHistory(history), () => postHistory(history));
          }
        } else {
          // Modal dismissed (Esc, click-outside) OR user clicked "Abbrechen" —
          // both resolve to a non-"Laden" value. Treat as abort so the cellset
          // gets cleaned up server-side either way.
          await handleMdxMessage({ type: 'abort', cellsetId: out.cellsetId }, deps);
          const msg: MdxOutMessage = {
            type: 'result', ok: false,
            error: { code: 'aborted', message: vscode.l10n.t('Aborted — result would have had {0} cells.', out.cellCount.toLocaleString()) },
          };
          postTo<HostToWebview>(panel.webview, msg);
        }
        return;
      }

      if (out) { postTo<HostToWebview>(panel.webview, out); }

      // Record history only for a completed `execute` result.
      if (msg.type === 'execute' && out && out.type === 'result' && originalMdx.trim() !== '') {
        const entry: HistoryEntry =
          out.ok
            ? { mdx: originalMdx, timestamp: Date.now(), elapsedMs: out.elapsedMs, rowCount: out.table.dims.rows, colCount: out.table.dims.cols }
            : { mdx: originalMdx, timestamp: Date.now(), elapsedMs: 0, rowCount: 0, colCount: 0, error: out.error };
        history = addEntry(history, entry);
        saveHistory(history).then(() => postHistory(history), () => postHistory(history));
      }
    });
  }

  static disposeAll(): void {
    for (const p of MdxRunnerManager._panels.values()) { p.dispose(); }
    MdxRunnerManager._panels.clear();
  }

  /** Close every MDX-runner panel that belongs to the given server. */
  static disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    // Key shape is `${serverId}|${serverUrl}` — match by suffix.
    const suffix = `|${serverUrl}`;
    const toClose: vscode.WebviewPanel[] = [];
    for (const [key, panel] of MdxRunnerManager._panels) {
      if (key.endsWith(suffix)) { toClose.push(panel); }
    }
    for (const p of toClose) { p.dispose(); }
  }
}

registerServerDisposer('mdxRunner', (url) => MdxRunnerManager.disposePanelsForServer(url));
