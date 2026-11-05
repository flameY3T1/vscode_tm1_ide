import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import type { ProcessParameter, Tm1Config } from '../../tm1Rest/transport/types';
import { getProcess, PROCESS_FULL_SELECT } from '../../tm1Rest/processApi';
import { getMonacoHtml } from './processEditorMonacoWebview';
import { extractProcessData, getPanelTitle } from './processEditorUtils';
import { offerDraftRecovery } from './draftRecovery';
import type { WebviewToHost } from '../../webviewClient/processEditorMonaco/protocol';
import {
  _sessions, type PanelSession, type ProcessCodeData,
  draftKeyOf, getActivePanel, getExtensionUri, isLive, newPanelSession, panelKey, serverLabel, sessionScope, sessionOfPanel, setLastActivePanel,
} from './state';
import { registerWindow, unregisterWindow } from '../../workbench/windowRegistry';
import { postTo } from '../../webviews/typedPost';
// reveal.section is typed string by every caller of openProcess; they all pass a process section.
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';
import type { SectionKey } from '../../webviewClient/processEditorMonaco/sectionTypes';
/**
 * Opens (or focuses) the Process Editor panel for `processName` on the given
 * server. Loads process data from TM1, wires up the message dispatcher, and
 * kicks off the git-drift check fire-and-forget.
 *
 * @returns `true` when an editor for the process is open afterwards, `false`
 *  when the open failed (no extensionUri, or the process could not be loaded —
 *  both show an error toast and leave no panel behind). Callers that act on a
 *  successful open (e.g. recording a "Recently opened" entry) MUST check this;
 *  awaiting alone does not mean the editor appeared.
 */
/**
 * Timeout for loading a process into the editor.
 *
 * Without this value, `tm1.timeoutMs` applies, and its default is **0** = no
 * idle timer at all (`tm1Rest/client.ts#getTimeoutMs`). That is right for
 * long runners like process execution and rule saving, but not for a single
 * GET: if the socket hangs (a half-open keep-alive connection that the peer
 * silently closed), the promise never settles. The result was a process
 * editor that stayed permanently empty — with a toolbar, tabs and status
 * line, but no code and no message at all, because the error handling was
 * never reached.
 *
 * It is an IDLE timeout (`transport/http.ts`), not an overall deadline: a
 * large process may transfer for as long as it likes, as long as data keeps
 * flowing. One minute of silence here reliably means nothing more is coming.
 */
const LOAD_TIMEOUT_MS = 60_000;

export async function openProcess(processName: string, _node: any, config: Tm1Config, reveal?: { section: string; line: number }): Promise<boolean> {
  const extensionUri = getExtensionUri();
  if (!extensionUri) {
    vscode.window.showErrorMessage(vscode.l10n.t('Process Editor: extensionUri not available (extension not activated yet?).'));
    return false;
  }
  const serverKey = config?.serverUrl ?? '__default__';
  const key = panelKey(sessionScope(config), processName);

  const existing = _sessions.get(key)?.panel;
  if (existing) {
    existing.reveal();
    if (reveal) {
      postTo<HostToWebview>(existing.webview, { type: 'revealSectionLine', section: reveal.section as SectionKey, line: reveal.line });
    }
    return true;
  }

  const panel = vscode.window.createWebviewPanel(
    'tm1ProcessEditor',
    getPanelTitle(processName, false, serverLabel(serverKey)),
    // Symbolic column: opens in the active group and thus in the same window
    // as the click that triggered it.
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
  return attachProcessPanel(panel, processName, config, reveal, async () => {
    let json: any;
    try {
      // `VariablesUIData` sits outside the default projection — a plain GET returns
      // the entity without it. Every field is named because `$select=*` would
      // strip the DataSource down to its bare `Type`.
      json = await getProcess(config, processName, { select: PROCESS_FULL_SELECT }, LOAD_TIMEOUT_MS);
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load process: {0}', errMsg(err)));
      return undefined;
    }
    const processData = extractProcessData(processName, json);
    // A previous panel was closed with unsaved changes: offer them back before
    // the server version is handed to the webview. Declining discards the draft
    // — otherwise the prompt would return on every future open.
    const recovered = await offerDraftRecovery(draftKeyOf(serverKey, processName), processName);
    return {
      prolog: recovered?.sections.prolog ?? processData.prolog,
      metadata: recovered?.sections.metadata ?? processData.metadata,
      data: recovered?.sections.data ?? processData.data,
      epilog: recovered?.sections.epilog ?? processData.epilog,
      parameters: processData.parameters ?? [],
      variables: processData.variables ?? [],
      hasSecurity: processData.hasSecurity,
      dataSource: processData.dataSource,
      // Restored content differs from the server — the panel opens dirty, so the
      // user cannot mistake it for what TM1 holds.
      dirty: !!recovered,
    };
  });
}

/** What a panel source hands to `attachProcessPanel`. */
export interface ProcessPanelData extends ProcessCodeData {
  dataSource: unknown;
  /** Open with the dirty marker (e.g. a recovered draft). */
  dirty?: boolean;
}

/**
 * Wires an EXISTING webview panel as a process editor: registry, icon, mute,
 * synchronous unregister on dispose, message listener, HTML. Data comes from
 * `load()` (`undefined` = load failed, the panel is disposed); the panel
 * hydrates once both the data and `monacoReady` are there. `onMessage` lets a
 * caller handle a message first — return true to stop the default handling.
 *
 * @returns `true` when the editor is open afterwards, see `openProcess`.
 */
export async function attachProcessPanel(
  panel: vscode.WebviewPanel,
  processName: string,
  config: Tm1Config,
  reveal: { section: string; line: number } | undefined,
  load: () => Promise<ProcessPanelData | undefined>,
  onMessage?: (msg: WebviewToHost) => Promise<boolean>,
): Promise<boolean> {
  const extensionUri = getExtensionUri();
  if (!extensionUri) {
    vscode.window.showErrorMessage(vscode.l10n.t('Process Editor: extensionUri not available (extension not activated yet?).'));
    panel.dispose();
    return false;
  }
  const serverKey = config?.serverUrl ?? '__default__';
  const key = panelKey(sessionScope(config), processName);
  setPanelIcon(panel, 'tm1ProcessEditor');
  muteWebviewOnDispose(panel);

  const session: PanelSession = newPanelSession(panel, processName, serverKey, config);
  session.pendingReveal = reveal;
  _sessions.set(key, session);
  registerWindow({
    kind: 'tm1ProcessEditor', rawKey: key, panel,
    serverId: serverKey, target: processName,
  });
  setLastActivePanel(panel);

  panel.webview.html = getMonacoHtml(panel.webview, extensionUri);

  panel.onDidChangeViewState(e => {
    if (e.webviewPanel.active) { setLastActivePanel(e.webviewPanel); }
  });

  // Captured below; disposed on panel close so the message listener does not
  // outlive the panel (F4).
  // eslint-disable-next-line prefer-const -- captured by the onDidDispose closure below, assigned after.
  let msgSub: vscode.Disposable | undefined;
  panel.onDidDispose(() => {
    // Synchronous — must run before the dynamic import below. `disposeAll()`
    // (lifecycle.ts) calls `panel.dispose()` on every panel and then clears
    // `_panels` in the SAME tick; a dynamic-import-based unregister would run
    // at least one microtask later and find `_panels` (and any lookup keyed
    // off it) already empty, leaking the entry into the registry forever.
    unregisterWindow(panel);
    msgSub?.dispose();
    // Also SYNCHRONOUS, for the same reason as the unregister above — and for
    // a second one that became visible on 2026-08-30 as "Webview is
    // disposed" (three times) when disconnecting: `onDisconnected` closes the
    // panels, then `onServerChanged` fires IMMEDIATELY afterwards, and its
    // subscribers run via `_panels` — `getActivePanel()` reads `p.active`,
    // `broadcastV12Mode()` and `broadcastSnippets()` post. Three accesses to
    // a closed panel, three errors. Only the entry of THIS panel: a reopen
    // under the same key may already have registered its successor.
    if (isLive(session)) { _sessions.delete(key); }
    if (getActivePanel() === panel) { setLastActivePanel(null); }
    // Forward to lifecycle.onPanelDisposed via dynamic import to avoid cycle.
    // It holds this session object, so it can never touch a successor's state.
    void import('./lifecycle').then(m => m.onPanelDisposed(session));
  });

  // Attach the message listener SYNCHRONOUSLY, before any awaited network I/O, so
  // a fast-loading webview's `monacoReady` can never be dropped (was the cause of
  // the intermittent empty editor). handleMessage is lazy-imported per message to
  // keep the attach synchronous and avoid a module cycle.
  msgSub = panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
    if (onMessage && await onMessage(msg)) { return; }
    const { handleMessage } = await import('./messaging');
    await handleMessage(session, msg, async (newName) => {
      await openProcess(newName, undefined, config);
    });
  });

  try {
    const loaded = await load();
    if (!loaded) {
      panel.dispose();
      return false;
    }
    // Closed while loading (or replaced by a reopen): the panel is dead, its
    // webview throws on post.
    if (!isLive(session)) { return false; }
    const { dataSource, dirty, ...code } = loaded;
    session.code = code;
    session.dataSource = dataSource;
    if (dirty) {
      session.dirty = true;
      panel.title = getPanelTitle(processName, true, serverLabel(serverKey));
    }
    // Data is stored now. If the webview already signalled `monacoReady` (fast
    // load beat the fetch), hydrate it here; otherwise the monacoReady handler
    // will. hydratePanel is idempotent via `session.hydrated`.
    if (session.ready) {
      const { hydratePanel } = await import('./messaging');
      hydratePanel(session);
    }
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to load process: {0}', errMsg(err)));
    panel.dispose();
    return false;
  }
  return true;
}

/**
 * Parameter list of the active panel, read from host state: the debounced
 * `processDraft` mirror when the user has edited, else the loaded server copy.
 * (Was a `monacoRequestParameters` round trip the webview never answered —
 * every call waited 2 s and returned [].)
 */
export async function getActivePanelParameters(): Promise<ProcessParameter[]> {
  const panel = getActivePanel();
  const session = panel ? sessionOfPanel(panel) : undefined;
  if (!session) { return []; }
  return (session.draft?.parameters as ProcessParameter[] | undefined)
    ?? session.code?.parameters ?? [];
}
