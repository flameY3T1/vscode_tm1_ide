import * as vscode from 'vscode';
import { setPanelIcon } from './panelIcons';
import { errMsg } from '../utils/errMsg';
import { registerWindow, unregisterWindow } from '../workbench/windowRegistry';
import { runWithAbortSignal } from '../tm1Rest/transport/abortScope';

/**
 * Substitute webview for a closed panel.
 *
 * Reason: `WebviewPanel.webview` is a getter in VS Code that THROWS
 * `Webview is disposed` after closing — the access itself, not just the
 * posting. An `onMessage` handler that waits for a REST response while
 * the user disconnects or closes the window ends up in exactly this situation:
 * `panel.webview.postMessage(...)` throws the rug out from under it. Of 29
 * consumers of the host, two had a `panelDisposed` guard of their own, 21
 * work asynchronously — adding the guard per caller would mean touching ~50 places
 * and forgetting it again at the next consumer.
 *
 * That is why the host, when closing, attaches this substitute as an OWN property
 * to the panel and thereby shadows the throwing getter. `postMessage` returns
 * `false` — the answer that the API gives elsewhere for "not delivered",
 * so not a silent success.
 */
function deadWebview(prev: vscode.Webview): vscode.Webview {
  return {
    html: '',
    options: prev.options,
    cspSource: prev.cspSource,
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: () => ({ dispose: () => { /* nichts mehr zu empfangen */ } }),
    postMessage: () => Promise.resolve(false),
  };
}

/**
 * Same protection for a panel built without the host: after `onDidDispose`,
 * `panel.webview` no longer throws but returns the silent replacement above.
 * Call it right after `createWebviewPanel`, before any async handler can run.
 * Guarded by `panelHostGuard.test.ts` for every module on its allow list.
 */
export function muteWebviewOnDispose(panel: vscode.WebviewPanel): void {
  // Capture while alive: the getter throws once the panel is gone.
  const webview = panel.webview;
  panel.onDidDispose(() => {
    Object.defineProperty(panel, 'webview', {
      value: deadWebview(webview), configurable: true, enumerable: true,
    });
  });
}

/**
 * Central panel lifecycle host (A1, 2026-06-10): encapsulates the pattern duplicated in ~26 managers:
 * `_extensionUri` + `_panels` map + `initialize*()` +
 * `disposeAll*()` + reveal-existing + `createWebviewPanel` + dispose cleanup +
 * try/catch message handler.
 *
 * Panel options are fixed: `enableScripts`, `retainContextWhenHidden`
 * (default true), `localResourceRoots: [out, media]`.
 */
export interface PanelHostOpenArgs<TMsg> {
  /** Map key (e.g. serverId or `${serverId}::${objName}`). */
  key: string;
  title: string;
  /** HTML renderer, typically the `getHtml` of the associated shell. */
  html: (webview: vscode.Webview, extensionUri: vscode.Uri) => string;
  /** Domain handler; throws end up in `onError` or the default toast. */
  onMessage: (msg: TMsg, panel: vscode.WebviewPanel) => unknown;
  /** Override for the error channel; default: `showErrorMessage('<panel title>: <reason>')`. */
  onError?: (reason: string, msg: TMsg, panel: vscode.WebviewPanel) => void;
  /** Additional cleanup on dispose (the map entry is always removed). */
  onDispose?: () => void;
  /**
   * Column for the NEW panel. Omitting it is the normal case — the default
   * `ViewColumn.Active` is symbolic ("the currently active group") and so lets
   * the panel open in the window from which it was opened
   * (also in a window detached via "Move Editor into New Window").
   * A fixed column (`One`/`Two`/`Beside`) ONLY with an explanatory comment.
   */
  viewColumn?: vscode.ViewColumn;
}

export class WebviewPanelHost<TMsg = unknown> {
  private _extensionUri: vscode.Uri | null = null;
  private readonly _panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly viewType: string,
    private readonly label: string,
    private readonly options: { retainContextWhenHidden?: boolean } = {},
  ) {}

  initialize(extensionUri: vscode.Uri): void {
    this._extensionUri = extensionUri;
  }

  disposeAll(): void {
    for (const p of this._panels.values()) p.dispose();
    this._panels.clear();
  }

  /**
   * Close every panel belonging to one server (on disconnect). Matches keys that
   * are exactly `serverId` or start with `${serverId}::` (composite object keys).
   */
  disposePanelsForServer(serverId: string): void {
    if (!serverId) return;
    const prefix = `${serverId}::`;
    // Collect first — dispose() fires onDidDispose which mutates _panels mid-iteration.
    const toClose: vscode.WebviewPanel[] = [];
    for (const [key, panel] of this._panels) {
      if (key === serverId || key.startsWith(prefix)) toClose.push(panel);
    }
    for (const p of toClose) p.dispose();
  }

  get(key: string): vscode.WebviewPanel | undefined {
    return this._panels.get(key);
  }

  /** Bring an existing panel to the front; true if there is one. */
  reveal(key: string): boolean {
    const existing = this._panels.get(key);
    if (existing) {
      existing.reveal();
      return true;
    }
    return false;
  }

  /**
   * Create and wire a new panel. Returns `null` if the host
   * is not initialized or a panel already exists under `key`
   * (then only reveal).
   */
  open(args: PanelHostOpenArgs<TMsg>): vscode.WebviewPanel | null {
    if (!this._extensionUri) {
      vscode.window.showErrorMessage(vscode.l10n.t('{0} not initialized', this.label));
      return null;
    }
    if (this.reveal(args.key)) return null;
    const extensionUri = this._extensionUri;

    const panel = vscode.window.createWebviewPanel(
      this.viewType,
      args.title,
      args.viewColumn ?? vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: this.options.retainContextWhenHidden ?? true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'out'),
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );
    setPanelIcon(panel, this.viewType);

    // Hold on to it once while the panel lives: after closing, the
    // `webview` getter throws (see `deadWebview`), and the cleaner still needs it.
    const webview = panel.webview;
    webview.html = args.html(webview, extensionUri);
    this._panels.set(args.key, panel);
    // Window directory: the host reports the RAW key and does not interpret it
    // — the key forms are inconsistent (most hosts use
    // `serverId::object`, `reorderDims` only the cube name), and the child table
    // that knows this lies one layer higher and must not be imported here.
    registerWindow({ kind: this.viewType, rawKey: args.key, panel });

    let disposed = false;
    const subs: vscode.Disposable[] = [];
    // Reads still in flight when the panel closes are cancelled (GET only).
    const abort = new AbortController();

    panel.onDidDispose(() => {
      disposed = true;
      unregisterWindow(panel);
      // SYNCHRONOUSLY, before anything else: subscribers of `onServerChanged` run
      // right after on disconnect over the panel registries and would otherwise still
      // carry a closed panel (2026-08-30, reported three times).
      this._panels.delete(args.key);
      for (const s of subs) { s.dispose(); }
      subs.length = 0;
      // Running handlers may post into the void instead of throwing.
      Object.defineProperty(panel, 'webview', {
        value: deadWebview(webview), configurable: true, enumerable: true,
      });
      abort.abort();
      args.onDispose?.();
    });

    subs.push(webview.onDidReceiveMessage(async (msg: TMsg) => {
      // Message after closing: the handler would no longer have a target. This
      // replaces the hand-written `if (panelDisposed) return;` line at the
      // start of every consumer.
      if (disposed) { return; }
      try {
        await runWithAbortSignal(abort.signal, () => args.onMessage(msg, panel));
      } catch (e) {
        // Silent after closing: the error comes from the cancel itself
        // (cancelled request, session gone) and the user no longer has a window
        // to which a message could refer.
        if (disposed) { return; }
        const reason = errMsg(e);
        if (args.onError) args.onError(reason, msg, panel);
        // The panel title, not `label`: labels are internal CamelCase names
        // ('ProcessRunAnalysis', 'UserGroupManager') that a user cannot place
        // (review 2026-10-03, A10). The title is what the tab shows.
        else vscode.window.showErrorMessage(vscode.l10n.t('{0}: {1}', panel.title, reason));
      }
    }));

    return panel;
  }
}
