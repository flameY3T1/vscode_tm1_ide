import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import { getHtml } from './dimensionBrowserWebview';
import type {
  DimElementSelection,
  HostToWebview,
  WebviewToHost,
} from '../../webviewClient/dimensionBrowser/protocol';
import {
  _handleMessage,
  _loadDimension,
  _fetchDimensions,
  _panelTitle,
  type DimBrowserOptions,
} from './dimensionBrowserHandlers';
import { errMsg } from '../../utils/errMsg';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { registerWindow } from '../../workbench/windowRegistry';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';
import { releaseMemberSet } from './viewRowsHandler';

// Re-export shared types + the message router so legacy importers and tests
// keep working (Cube Viewer / Process Editor pickers, extension host,
// dimensionBrowserMessaging test all import from this module).
export type { DimElementSelection, DimBrowserOptions };
export { _handleMessage };

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

// Lifecycle (key map, initialize, reveal, disposePanelsForServer, try/catch
// dispatch) lives in the shared host. Keys MUST use its `${serverId}::` shape —
// that is what `disposePanelsForServer` matches on a disconnect.
//
// Standalone: one panel per server+dimension. Arbitrarily many dims can be open
// side by side; opening the SAME dim again reveals its existing panel.
// Selection mode: every call gets a FRESH panel (pickers must be able to stack),
// so its key carries a per-open counter and can never be revealed — but it still
// starts with the server prefix, so a disconnect closes it along with the rest.
const _host = new WebviewPanelHost<WebviewToHost>('tm1DimensionBrowser', 'Dimension Browser');

function _serverId(config: Tm1Config): string {
  return config?.serverUrl ?? '__default__';
}

// `dim#` / `sel#` right behind the `::` keep the two key spaces disjoint, so no
// dimension name can ever alias a selection panel into the reveal path.
function _panelKey(config: Tm1Config, dimName: string | undefined): string {
  // Identity tag: two profiles on one URL must not share a panel (or its config).
  return `${_serverId(config)}::dim#@${identityTag(config)}#${dimName ?? ''}`;
}

let _selSeq = 0;

// Latest options per panel: a reveal replaces them, and the ready replay must use the current ones.
const _panelOptions = new WeakMap<vscode.WebviewPanel, DimBrowserOptions>();

function _selectionPanelKey(config: Tm1Config): string {
  return `${_serverId(config)}::sel#${++_selSeq}`;
}

/**
 * The `setMode` payload telling the webview which subset to land on.
 *
 * Needed by BOTH open paths. Because panels are keyed per dimension, clicking a
 * second subset of an already-open dimension goes through `reveal()` instead of
 * a fresh panel — and revealing alone leaves the panel sitting on the subset it
 * was first opened with.
 */
function _setModeMsg(options: DimBrowserOptions): Extract<HostToWebview, { type: 'setMode' }> {
  return {
    type: 'setMode',
    mode: options.mode,
    multiSelect: options.multiSelect,
    allowedTypes: options.allowedTypes ?? null,
    initialSelection: options.initialSelection ?? [],
    // In editSubset mode, don't apply initialSubset as a left-pane filter —
    // the user needs all elements visible to be able to add to the subset.
    initialSubset: options.editSubset ? null : (options.initialSubset ?? null),
    initialAlias: options.initialAlias,
    initialSourceMdx: options.initialSourceMdx ?? null,
    acceptsExpression: !!options.acceptsExpression,
    initialSourceNote: options.initialSourceNote ?? null,
    hierSwitch: options.hierSwitch ?? null,
  };
}


/** Wire the extension URI so the webview shell can resolve the bundled JS via `webview.asWebviewUri`. */
export function initializeDimensionBrowser(extensionUri: vscode.Uri): void {
  _host.initialize(extensionUri);
}

/**
 * Close all dimension-browser panels for the given server, if open — INCLUDING
 * selection-mode pickers, which used to stay open on a disconnect (they were
 * never registered), holding on to a dead `Tm1Config` and a live listener.
 */
export function disposeDimensionBrowserForServer(serverUrl: string): void {
  _host.disposePanelsForServer(serverUrl);
}

registerServerDisposer('dimensionBrowser', (url) => disposeDimensionBrowserForServer(url));

/**
 * Opens (or reveals) the Dimension Browser webview.
 * If dimName is provided, pre-loads that dimension.
 * Pass options to open in selection mode (e.g. for Cube Viewer axis element picker).
 */
export async function openDimensionBrowser(dimName: string | undefined, config: Tm1Config, options?: DimBrowserOptions): Promise<void> {
  const isSelection = options?.mode === 'selection';

  // In selection mode: always open a fresh panel (no reuse) under a key of its
  // own. Standalone: reuse only the panel of the SAME dim (reload honors a new
  // initialSubset/-Hier). The reveal happens HERE rather than inside
  // `_host.open`, because the reload path needs the panel object to re-post
  // setMode/expression onto it.
  const panelKey = isSelection ? _selectionPanelKey(config) : _panelKey(config, dimName);
  const existing = isSelection ? undefined : _host.get(panelKey);

  if (existing) {
    existing.reveal();
    if (dimName) {
      post(existing, { type: 'setLoading', loading: true });
      // Announce the subset that was JUST clicked, before reloading the dimension.
      // Same order as a fresh open (setMode → expression → setHierarchies), so the
      // pending subset the webview stashes gets consumed by the `setSubsets` that
      // `_loadDimension` triggers. Without this the panel keeps showing whichever
      // subset it was first opened with.
      if (options) {
        _panelOptions.set(existing, options);
        post(existing, _setModeMsg(options));
      }
      try {
        await _loadDimension(existing, dimName, config, options?.initialHier);
      } catch (err) {
        post(existing, { type: 'setError', message: errMsg(err) });
      }
    }
    return;
  }

  const title = _panelTitle(config, dimName, isSelection);

  // P1-8b (Stufe 4 Race-Protokolle): setMode (and, in editSubset mode,
  // setSubsetExpression) are posted synchronously below, right after the
  // listener is registered — before any await. If the webview's own message
  // listener (`initMsgHandler` in webviewClient/dimensionBrowser/index.ts)
  // hasn't run yet (script still loading/parsing in the iframe), that post is
  // lost and the browser never learns its selection-mode config. Stash the
  // latest value of each so the `webviewReady` handshake below can resend
  // them — mirrors cubeViewer (manager.ts `initDataPayload`) / mdxRunner
  // (`_pendingMdx`).

  // The same safety net for the LOAD MESSAGES (`attrColumns`, `setHierarchies`,
  // `setAttrCubeExists`).
  //
  // Until now they stood outside of it: `_loadDimension` posts them behind ONE
  // `await` (the hierarchy query to TM1), and that single round trip was the
  // entire time window the webview had to load. If it wasn't enough,
  // `setHierarchies` disappeared — and it is exactly that message which triggers
  // `startView`/`fetchRows()`. Result: the spinner keeps turning, only the hierarchy
  // query ran on the server, and closing and reopening helped (the bundle is
  // then warm). Reported 2026-09-20, "sometimes".
  //
  // After the handshake everything goes straight through — the fallback resend
  // is only for the window before it.
  let webviewReady = false;
  const pending: HostToWebview[] = [];
  // The dimension this panel shows, set once the initial load starts. A second
  // `webviewReady` means the iframe was rebuilt ("Move into New Window" reloads
  // the webview even with `retainContextWhenHidden`) and has to load it again.
  let loadedDim: string | undefined;
  const postInit = (m: HostToWebview): void => {
    // `panel` is already assigned here — every call sits behind the null guard
    // further below. The check is still there because the type checker does
    // not see through a closure.
    if (!panel) { return; }
    if (!webviewReady) { pending.push(m); }
    post(panel, m);
  };

  // Messages can still be delivered after the panel is gone (queued in the
  // iframe, or a round trip that outlived a disconnect). Every branch below ends
  // in `postMessage`, which throws on a disposed webview — so drop them here.
  // This replaces the explicit `msgSub.dispose()` the hand-rolled lifecycle did.
  let panelDisposed = false;

  const panel = _host.open({
    key: panelKey,
    title,
    // No fixed column: callers that are themselves a panel (Cube Viewer) pass
    // their own `panel.viewColumn` in, so the browser opens in THEIR window.
    // Without one given, the host default `ViewColumn.Active` applies —
    // previously this was hardcoded to `One`, which always forced the
    // browser into the main window.
    viewColumn: options?.viewColumn,
    html: getHtml,
    onDispose: () => { panelDisposed = true; if (panel) { releaseMemberSet(panel, config); } },
    onMessage: async (msg, p) => {
      if (panelDisposed || !msg?.type) { return; }
      if (msg.type === 'webviewReady') {
        if (webviewReady) {
          // Reloaded iframe: everything the first handshake delivered is gone.
          // Without this the spinner turned forever after moving the panel.
          const current = _panelOptions.get(p);
          if (current) { post(p, _setModeMsg(current)); }
          if (loadedDim) {
            post(p, { type: 'setLoading', loading: true });
            await _loadDimension(p, loadedDim, config, current?.initialHier);
          }
          return;
        }
        // Handshake safety net: resend whatever init config was posted eagerly
        // above, in case the client's message listener wasn't registered yet.
        webviewReady = true;
        const current = _panelOptions.get(p);
        if (current) { post(p, _setModeMsg(current)); }
        // In the SAME order as the first time: `attrColumns` must come before
        // `setHierarchies`, otherwise the first window fetches without the
        // remembered columns and immediately reloads (see `_loadDimension`).
        for (const m of pending) { post(p, m); }
        pending.length = 0;
        return;
      }
      await _handleMessage(p, msg, config, options);
    },
    // The browser reports failures inside its own panel, not as a toast — that
    // is exactly what the host's error hook is for.
    onError: (reason, _msg, p) => {
      if (panelDisposed) { return; }
      post(p, { type: 'setError', message: reason });
    },
  });

  if (!panel) {
    // Only reachable when `initializeDimensionBrowser` was never called — the
    // reveal case is already handled above. The host has shown the toast.
    throw new Error('Dimension Browser not initialized — call initializeDimensionBrowser(extensionUri) on activation.');
  }

  if (isSelection) {
    // The host has already registered itself with `kind = 'tm1DimensionBrowser'`.
    // Selection panels run under `${serverUrl}::sel#<n>` and are throwaway
    // windows — here they get re-registered in the transient way.
    registerWindow({ kind: 'tm1DimensionBrowserSelection', rawKey: panelKey, panel });
  } else {
    // The automatic host registration (`webviewPanelHost.ts#open`) only knows
    // the raw key `${serverUrl}::dim#${dimName}` — without its own `keyShape`
    // for it, `splitRawKey` cuts `target = 'dim#Kunde'` out of that instead of
    // `'Kunde'`, and the selection window/tree/restore then show or open the
    // wrong "dimension". Like the other four self-registering managers
    // (Cube Viewer, Rule Editor, Chore Editor, Process Editor), we register
    // here EXPLICITLY — `registerWindow` looks up by panel reference and
    // overwrites the host entry at the same spot, this time with the correct
    // `target`.
    registerWindow({ kind: 'tm1DimensionBrowser', rawKey: panelKey, panel, serverId: _serverId(config), target: dimName });
  }

  post(panel, { type: 'setLoading', loading: true });

  // Inform the webview of the operating mode before data arrives. Both messages
  // are stashed as well, so the `webviewReady` handshake above can resend them
  // if the client's listener was not registered yet.
  if (options) {
    _panelOptions.set(panel, options);
    post(panel, _setModeMsg(options));
  }

  try {
    // No in-window dim switcher anymore — each panel is bound to ONE dim.
    // Callers without a dimName (generic "browse" entry) get the first dim.
    const selectedDim = dimName ?? (await _fetchDimensions(config))[0] ?? '';

    if (selectedDim) {
      loadedDim = selectedDim;
      await _loadDimension(panel, selectedDim, config, options?.initialHier, postInit);
    } else {
      postInit({ type: 'setLoading', loading: false });
      postInit({ type: 'setError', message: vscode.l10n.t('No dimensions found.') });
    }
  } catch (err) {
    // Also via `postInit`: a lost error message would leave behind an empty
    // window with no explanation at all — the worst outcome of all.
    postInit({ type: 'setError', message: errMsg(err) });
  }
}
