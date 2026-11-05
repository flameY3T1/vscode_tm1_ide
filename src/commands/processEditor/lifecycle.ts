import * as vscode from 'vscode';
import { getV12DeprecatedNames } from './processEditorUtils';
import { _debugSessions, _sessions, type PanelSession, draftKeyOf, getSnippets, sessionOfPanel, sessionsOfProcess } from './state';
import { getExtensionContext } from '../../utils/extensionContext';
import { cleanupDebugSession } from './debugSession';
import { saveDraft } from './draftStore';
import { errMsg } from '../../utils/errMsg';
import { isV12Active } from '../../utils/v12Mode';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

/**
 * Sends updated V12 mode state to every open process editor panel.
 *
 * Per panel, not once for all of them: each panel is bound to the server it was opened from
 * (`PanelMeta.config`), so a v12 connection must not put an 11.x process editor into V12 mode.
 * Panels with no meta fall back to the setting alone.
 */
export function broadcastV12Mode(): void {
  for (const s of _sessions.values()) {
    postV12Mode(s.panel);
  }
}

/**
 * Sends a single panel its v12 state.
 *
 * Needed in addition to the broadcast, because the broadcast only runs on a
 * CHANGE (a switch flipped, the connection changed). A freshly opened panel
 * never experiences a change and would otherwise never learn what it is
 * connected to — the message has always been sent, but nobody evaluated it,
 * and that is exactly why the process editor offered v12 features on 11.x.
 */
export function postV12Mode(panel: vscode.WebviewPanel): void {
  const v12Mode = isV12Active(sessionOfPanel(panel)?.config);
  postBestEffort(panel, { type: 'v12ModeChanged', v12Mode, v12DeprecatedNames: getV12DeprecatedNames() });
}

/**
 * A message whose absence breaks nothing.
 *
 * A `postMessage` on a closed panel throws synchronously ("Webview is
 * disposed"); a message that cannot be delivered rejects asynchronously.
 * Both are swallowed here — the same pattern as in `messageLogAnalysis.ts`.
 *
 * The actual cause of the 2026-08-30 case was NOT here but in `_panels`,
 * which still carried a closed panel (fixed in `openPanel.ts`). This guard is
 * the second line of defense: a broadcast is a display refresh, not an
 * operation that deserves an error.
 * Deliberately NOT extended to `getActivePanel()` — if THAT hits a dead
 * panel, the bookkeeping is broken, and that should stay loud.
 */
function postBestEffort(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  try {
    Promise.resolve(postTo<HostToWebview>(panel.webview, msg)).catch(() => { /* not delivered */ });
  } catch { /* panel closed in the meantime */ }
}

/**
 * Sends a panel its own TM1 snippets.
 *
 * Push instead of baked into the HTML once: the list depends on the active
 * server and changes while the panel is open (a snippet gets created,
 * changed, deleted). A framework rendered just once would never notice.
 */
export function postSnippets(panel: vscode.WebviewPanel): void {
  postBestEffort(panel, { type: 'snippets', snippets: getSnippets() });
}

/** After every change to the snippets: refresh all open panels. */
export function broadcastSnippets(): void {
  for (const s of _sessions.values()) {
    postSnippets(s.panel);
  }
}

/** Closes all open panels (e.g. on server change). Returns false if user cancelled. */
export async function disposeAll(): Promise<boolean> {
  const hasDirty = Array.from(_sessions.values()).some(s => s.dirty);
  if (hasDirty) {
    const YES = vscode.l10n.t('Yes');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('There are unsaved changes. Close all panels anyway?'),
      { modal: true },
      YES
    );
    if (answer !== YES) {
      return false;
    }
  }
  // Clean up debug sessions
  const debugCleanups = Array.from(_debugSessions.keys()).map(key => cleanupDebugSession(key));

  for (const s of [..._sessions.values()]) {
    s.panel.dispose();
  }
  _sessions.clear();

  await Promise.all(debugCleanups);
  return true;
}

/** Close every process-editor panel that belongs to the given server. */
export function disposePanelsForServer(serverUrl: string): void {
  if (!serverUrl) { return; }
  const prefix = `${serverUrl}|`;
  const toClose: vscode.WebviewPanel[] = [];
  for (const [key, s] of _sessions) {
    if (key.startsWith(prefix)) { toClose.push(s.panel); }
  }
  for (const p of toClose) { p.dispose(); }
}

registerServerDisposer('processEditor', (url) => disposePanelsForServer(url));

/**
 * Close the open process-editor panel for a single process (e.g. after the
 * process was deleted on the server). No-op if no panel is open. `panel.dispose()`
 * triggers `onPanelDisposed` which unregisters it.
 */
export function disposePanel(processName: string, serverUrl?: string): void {
  for (const s of sessionsOfProcess(serverUrl ?? '__default__', processName)) { s.panel.dispose(); }
}

/**
 * Final cleanup of a closed panel: debug session, recovery draft.
 *
 * Takes the closed panel's own session object, not its key: the key
 * `serverKey|processName` is reused by a reopen, and a cleanup keyed by it
 * that runs behind `await saveDraft(…)` used to clear the successor's state —
 * the intermittently empty process editor. The registry entry itself is
 * dropped synchronously in openPanel.ts's `onDidDispose`.
 */
export async function onPanelDisposed(session: PanelSession): Promise<void> {
  const key = session.key;
  const draft = session.draft;
  const wasDirty = session.dirty;

  // Clean up debug session if active — this also broadcasts `debugSessionEnded`
  // to every other panel the session touched and stops its poll/sync timers.
  void cleanupDebugSession(key);

  // A webview panel close cannot be intercepted — by the time this runs the
  // panel is already gone, so there is no prompt left to show. Park whatever the
  // editor last mirrored instead; `openProcess` offers it back.
  if (wasDirty && draft) {
    const memento = getExtensionContext()?.globalState;
    if (memento) {
      try {
        await saveDraft(memento, draftKeyOf(session.serverKey, session.processName), draft, Date.now());
        vscode.window.showWarningMessage(
          vscode.l10n.t('Unsaved changes to "{0}" were kept. Reopen the process to restore them.',
            session.processName),
        );
      } catch (err) {
        // Losing the draft silently is the failure mode this whole path exists
        // to prevent — say so rather than swallowing it.
        vscode.window.showErrorMessage(
          vscode.l10n.t('Unsaved changes to "{0}" could not be kept: {1}',
            session.processName, errMsg(err)),
        );
      }
    }
  }
}
