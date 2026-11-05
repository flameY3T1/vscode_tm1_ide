import * as vscode from 'vscode';
import type { DebugSession } from './state';
import { _debugSessions, _sessions, processNameOf, stopSessionSync } from './state';
import { outputChannel } from '../../utils/outputChannel';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

let _dbgLog: vscode.OutputChannel | undefined;
export function dbgLog(msg: string): void {
  if (!_dbgLog) { _dbgLog = outputChannel('TM1 Debug Routing'); }
  _dbgLog.appendLine(msg);
}

/**
 * Ends a debug session everywhere it has surfaced: posts `debugSessionEnded` to
 * every panel the highlight was routed to (so a handed-off main editor doesn't
 * stay stuck in debug mode), and removes the session from the registry under
 * whichever key currently owns it.
 *
 * Also flips the session to cancelled and kills its timers, so the long-poll
 * loop and the re-sync tick stop at their next checkpoint instead of outliving
 * the session.
 */
export function endSessionAllPanels(
  session: DebugSession,
  status: unknown,
  errorMessage: unknown,
  sourceKey?: string,
): void {
  session.cancelled = true;
  stopSessionSync(session);
  const keys = session.touchedKeys ?? new Set<string>();
  for (const k of keys) {
    const ps = _sessions.get(k);
    if (ps) { ps.lastDebugState = undefined; }
    const p = ps?.panel;
    if (p) {
      // The detail message (e.g. "Prozess ##sleep: …") belongs only to the
      // process it came from. Other panels (the main editor after a sub-process
      // ran) get the status without that sub-specific text.
      const detail = (sourceKey === undefined || k === sourceKey) ? errorMessage : undefined;
      try {
        postTo<HostToWebview>(p.webview, { type: 'debugSessionEnded', status, errorMessage: detail });
      } catch {
        // Panel disposed between lookup and post — nothing left to notify.
      }
    }
    if (_debugSessions.get(k) === session) { _debugSessions.delete(k); }
  }
  // Bring the main editor back to front so the user isn't stranded in a
  // sub-process editor that ran to completion (e.g. no breakpoint in main).
  const home = session.homeKey ? _sessions.get(session.homeKey)?.panel : undefined;
  if (home) { try { home.reveal(undefined, false); } catch { /* panel may be disposing */ } }
}

/**
 * Tears down the debug session owned by `panelKey` (panel closed, server
 * switched, editor disposed).
 *
 * Broadcasts `debugSessionEnded` to EVERY panel the session touched, not just
 * the one being cleaned up: after StepIn re-homed the session to a sub-process
 * panel, closing that tab used to leave the main editor sitting in debug mode
 * with a stale Prolog highlight, because cleanup notified nobody at all.
 */
export async function cleanupDebugSession(panelKey: string): Promise<void> {
  const processName = processNameOf(panelKey);
  const session = _debugSessions.get(panelKey);
  if (!session) { return; }
  _debugSessions.delete(panelKey);
  const ps = _sessions.get(panelKey);
  if (ps) { ps.lastDebugState = undefined; }
  // endSessionAllPanels cancels the session, stops its timers, notifies every
  // touched (still-live) panel and drops the remaining registry entries.
  endSessionAllPanels(session, 'Beendet', undefined, panelKey);
  try {
    await session.client.stop(session.debugId, processName);
  } catch { /* ignore stop errors during cleanup */ }
}
