import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { Tm1DebugClient, waitUntilSettled, type PollResult } from '../../debug/tm1DebugClient';
import { decideBreakpointStop } from '../../debug/conditionEval';
import type { DebugSession, BpRuntime } from './state';
import { getConfig } from '../../tm1Client';
import type { BreakpointMessage } from './processEditorTypes';
import { dbgLog, endSessionAllPanels } from './debugSession';
import {
  _debugSessions, _sessions,
  findPanelKey, processNameOf, bpKey, sameProcessName, setSessionBpRule, getBpRuntime,
  stopSessionSync, sessionScope,
} from './state';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

/** Interval of the live status re-sync (Fix 2). Cheap: one status GET per tick,
 *  plus call stack + variables only while actually paused. */
const SYNC_INTERVAL_MS = 2000;

/** A debug state message as posted to the webview. `currentSection`/`currentLine`
 *  are omitted when the server did not report them — never invented. */
type DebugStateMsg = Record<string, unknown> & { type: 'debugStateUpdate'; status: 'paused' | 'running' };

/**
 * Posts a debug state to a panel AND remembers it per panelKey.
 *
 * The webview is push-driven: on reload it re-runs `monacoReady` without the
 * panel being disposed, so without a remembered state it would come back in
 * edit mode while the server session is still paused.
 */
function postDebugState(key: string, panel: vscode.WebviewPanel, msg: DebugStateMsg): void {
  const s = _sessions.get(key);
  if (s) { s.lastDebugState = msg; }
  try {
    postTo<HostToWebview>(panel.webview, msg);
  } catch {
    // Panel disposed between lookup and post — the dispose path cleans up.
  }
}

/** "The process is running" — no section switch, no invented line highlight. */
function runningState(): DebugStateMsg {
  return { type: 'debugStateUpdate', status: 'running', variables: [] };
}

/** Builds a paused state, omitting section/line when the server didn't report them. */
function pausedState(
  section: string | undefined,
  line: number | undefined,
  vars: Array<{ name: string; value: string }>,
): DebugStateMsg {
  const msg: DebugStateMsg = { type: 'debugStateUpdate', status: 'paused', variables: vars };
  if (section !== undefined) { msg.currentSection = section; }
  if (line !== undefined) { msg.currentLine = line; }
  return msg;
}

/**
 * Waits until the process REALLY pauses or ends (see `waitUntilSettled`). On
 * the first poll timeout the webview is told the truth ("running", no
 * highlight) instead of a faked pause on the entry frame.
 *
 * Returns `null` when the session was cancelled while waiting (stop button,
 * panel disposed, server switched) — the caller must then post nothing, because
 * teardown has already notified every panel. An unreachable server throws; the
 * callers' catch ends the session and stops it on TM1.
 */
async function waitForPauseOrEnd(
  key: string,
  panel: vscode.WebviewPanel,
  session: DebugSession,
): Promise<PollResult | null> {
  let announcedRunning = false;
  const st = await waitUntilSettled(session.client, session.debugId, processNameOf(key), {
    abandoned: () => !!session.cancelled,
    onStillRunning: (pollError) => {
      dbgLog(`[poll] ${key} still running after the poll timeout${pollError ? ` (last error: ${pollError})` : ''} → keep polling`);
      if (!announcedRunning) {
        announcedRunning = true;
        postDebugState(key, panel, runningState());
      }
    },
  });
  if (session.cancelled) {
    dbgLog(`[poll] ${key} abandoned — session cancelled`);
    return null;
  }
  return st;
}

/** The panelKey that currently owns this session (StepIn re-homes it). */
function currentSessionKey(session: DebugSession): string | undefined {
  for (const [k, s] of _debugSessions) {
    if (s === session) { return k; }
  }
  return undefined;
}

/**
 * Periodic re-sync (Fix 2). Push-only was fragile: a single missed transition
 * pinned the editor on a stale frame for the rest of the session. While a
 * session lives we re-read the status (plus the call stack when paused) and push
 * the real state, so the UI heals itself.
 *
 * Skips while `busy` (user command / auto-continue loop mid-flight) and sets
 * `busy` itself, so ticks can never overlap each other or a command.
 */
async function syncTick(session: DebugSession): Promise<void> {
  if (session.cancelled) { stopSessionSync(session); return; }
  if (session.busy) { return; }
  const key = currentSessionKey(session);
  if (!key) { return; }
  const panel = _sessions.get(key)?.panel;
  if (!panel) { return; }
  session.busy = true;
  try {
    const st = await session.client.getStatus(session.debugId);
    if (session.cancelled) { return; }
    if (session.client.isEnded(st.status)) {
      dbgLog(`[sync] ${key} ended (${st.status}) — notifying panels`);
      endSessionAllPanels(session, st.executeStatus ?? st.status, st.errorLog, key);
      return;
    }
    if (st.status === 'Running') {
      postDebugState(key, panel, runningState());
      return;
    }
    const frames = await session.client.getCallStack(session.debugId);
    const top = frames[0];
    if (!top) { return; }
    const vars = await session.client.getVariables(session.debugId, top.id ?? '1');
    postDebugState(key, panel, pausedState(top.procedure, top.lineNumber, vars));
  } catch (err) {
    // A failing re-sync is not fatal — log it and try again on the next tick.
    dbgLog(`[sync] re-sync failed for ${key}: ${errMsg(err)}`);
  } finally {
    session.busy = false;
  }
}

/** Starts the periodic re-sync for a live session (idempotent). */
function startSessionSync(session: DebugSession): void {
  stopSessionSync(session);
  session.syncTimer = setInterval(() => { void syncTick(session); }, SYNC_INTERVAL_MS);
}

/**
 * Sends the paused-state highlight + variables to the editor of whichever
 * process the top call-stack frame is in. When StepIn descended into a
 * sub-process, opens that process's editor, re-homes the debug session to it
 * (so the step buttons follow), and clears the previous panel's highlight.
 *
 * Graceful fallback: if the server doesn't expose the frame's process name
 * (`frame.processName` undefined), routing is skipped and the state goes to the
 * current panel — i.e. behaves exactly as before.
 *
 * @returns the panelKey that now owns the session (== `currentKey` unless re-homed).
 */
/** A debug stop the user should actually see: condition true, unconditional, or
 *  uneval­uable (fail-safe). */
interface PausableStop {
  frames: Awaited<ReturnType<DebugSession['client']['getCallStack']>>;
  /** `undefined` when the server reported no procedure — no section switch. */
  section: string | undefined;
  /** `undefined` when the server reported no line — no highlight. */
  line: number | undefined;
  frameProc: string | undefined;
  vars: Array<{ name: string; value: string }>;
}

/** Resume past breakpoint stops whose condition is false until a real pause is
 *  reached. Owns the condition-eval / auto-continue loop so `emitPausedState`
 *  stays pure routing. Returns `null` if the session ended while skipping. */
async function advanceToPausableStop(
  currentKey: string,
  currentPanel: vscode.WebviewPanel,
  session: DebugSession,
): Promise<PausableStop | null> {
  let frames = await session.client.getCallStack(session.debugId);
  // While the stopped line's condition evaluates false, resume and poll again.
  // An unevaluable condition pauses fail-safe and reports it.
  for (;;) {
    if (frames.length === 0) {
      dbgLog(`[pause] empty call stack on ${currentKey} → session ended`);
      endSessionAllPanels(session, 'Beendet', undefined, currentKey);
      return null;
    }
    const top = frames[0];
    // No 'Prolog'/line-1 invention: an unknown position stays unknown, so the
    // editor neither switches section nor highlights a line the process is not on.
    const section = top?.procedure;
    const line = top?.lineNumber;
    const frameProc = top?.processName;
    if (section === undefined || line === undefined) {
      dbgLog(`[pause] top frame on ${currentKey} has no position (procedure=${String(section)}, line=${String(line)}) → no section switch, no highlight`);
    }
    const vars = await session.client.getVariables(session.debugId, top?.id ?? '1');

    // Without a known position no breakpoint rule can apply — pause fail-safe.
    const k = section !== undefined && line !== undefined ? bpKey(section, line) : undefined;
    const rule = k !== undefined ? session.breakpoints.get(k) : undefined;
    const decision = decideBreakpointStop(rule, vars, rule?.hits ?? 0);
    if (k !== undefined && decision.newHits !== (rule?.hits ?? 0)) {
      getBpRuntime(session, k).hits = decision.newHits;
    }
    if (decision.pause) {
      if (decision.error && section !== undefined && line !== undefined) {
        postTo<HostToWebview>(currentPanel.webview, { type: 'breakpointConditionError', section, line, message: decision.error });
      }
      return { frames, section, line, frameProc, vars };
    }
    dbgLog(`[pause] not paused at ${String(section)}:${String(line)} (condition false or hit-count not met) → auto-continue`);
    await session.client.continue(session.debugId);
    const st = await waitForPauseOrEnd(currentKey, currentPanel, session);
    if (!st) { return null; }
    if (session.client.isEnded(st.status)) {
      endSessionAllPanels(session, st.executeStatus ?? st.status, st.errorLog, currentKey);
      return null;
    }
    frames = await session.client.getCallStack(session.debugId);
  }
}

async function emitPausedState(
  currentKey: string,
  currentPanel: vscode.WebviewPanel,
  session: DebugSession,
): Promise<string> {
  const stop = await advanceToPausableStop(currentKey, currentPanel, session);
  if (!stop) { return currentKey; }
  const { frames, section, line, frameProc, vars } = stop;

  const pausedMsg = pausedState(section, line, vars);

  const current = _sessions.get(currentKey);
  const scope = sessionScope(current?.config);
  const homeProc = processNameOf(currentKey);

  dbgLog(`[pause] current=${currentKey} homeProc=${homeProc} topFrameProc=${frameProc ?? '(none)'} section=${String(section)} line=${String(line)} frames=${JSON.stringify(frames.map(f => ({ p: f.processName, proc: f.procedure, ln: f.lineNumber })))}`);

  // Same process, or server didn't tell us the frame's process → no routing.
  // The comparison MUST be case-insensitive: TM1 answers with the canonical
  // spelling while the panel key carries the opener's — a `===` here made the
  // process look like a foreign sub-process and opened a bogus second panel.
  if (!frameProc || sameProcessName(frameProc, homeProc)) {
    dbgLog(`[pause] → stay on ${currentKey}`);
    postDebugState(currentKey, currentPanel, pausedMsg);
    return currentKey;
  }

  // StepIn descended into a different process. Open/focus its editor. An editor
  // opened under a different spelling of the same name counts as open — opening
  // again would stack a duplicate panel next to it.
  let targetKey = findPanelKey(scope, frameProc);
  const routeCfg = current?.config;
  const alreadyOpen = _sessions.get(targetKey)?.panel;
  if (alreadyOpen) {
    try { alreadyOpen.reveal(undefined, false); } catch { /* panel may be disposing */ }
  } else if (routeCfg) {
    try {
      const mod = await import('./openPanel');
      await mod.openProcess(frameProc, undefined, routeCfg);
    } catch { /* if the sub-process editor can't open, fall back to current panel below */ }
    targetKey = findPanelKey(scope, frameProc);
  }

  const targetPanel = _sessions.get(targetKey)?.panel;
  if (!targetPanel) {
    // Could not open the sub-process editor — keep showing state on current panel.
    // No Recent entry either: nothing opened, and a dead entry would evict a real
    // one from the 5-slot list.
    postDebugState(currentKey, currentPanel, pausedMsg);
    return currentKey;
  }

  // The sub-process editor is open. openPanel never records a Recent entry
  // itself — stepping into a sub-process opens its editor, so it belongs in
  // "Recently opened" too.
  if (routeCfg) {
    const { getServerIdByUrl } = await import('../serverManager');
    const { recordProcessOpen } = await import('./recentBridge');
    recordProcessOpen(getServerIdByUrl(routeCfg.serverUrl), frameProc);
  }

  // Re-home the session so step commands from the sub-process panel drive this debugId.
  if (targetKey !== currentKey) {
    dbgLog(`[pause] → re-home ${currentKey} -> ${targetKey}`);
    _debugSessions.delete(currentKey);
    _debugSessions.set(targetKey, session);
    (session.touchedKeys ??= new Set()).add(targetKey);
    // Hand off the previous panel: clear its highlight, drop it out of paused mode.
    postDebugState(currentKey, currentPanel, runningState());
  }

  // Deliver the highlight — immediately if the target is hydrated, else queue
  // for flush on its `monacoReady`.
  const target = _sessions.get(targetKey);
  if (target?.hydrated) {
    postDebugState(targetKey, targetPanel, pausedMsg);
  } else if (target) {
    target.pendingDebugState = pausedMsg;
    target.lastDebugState = pausedMsg;
  }
  return targetKey;
}

/** Starts a debug session for the given process. */
export async function handleDebugStart(
  panelKey: string,
  panel: vscode.WebviewPanel,
  parameters: Array<{ Name: string; Value: string | number }>,
  pendingBreakpoints: Array<{ section: string; line: number; condition?: string; hitCondition?: string }> = [],
): Promise<void> {
  const processName = processNameOf(panelKey);
  const cfg = _sessions.get(panelKey)?.config ?? getConfig();
  try {
    const client = new Tm1DebugClient(cfg);

    // Send debugSessionStarted to webview
    postTo<HostToWebview>(panel.webview, { type: 'setLoading', loading: true });

    const state = await client.startDebug(processName, parameters);

    const bpIds = new Map<string, number>();
    // `busy` from the start: the re-sync tick must not race breakpoint creation
    // or the first pause routing below.
    _debugSessions.set(panelKey, { client, debugId: state.id, bpIds, nextBpId: 0, breakpoints: new Map<string, BpRuntime>(), touchedKeys: new Set([panelKey]), homeKey: panelKey, busy: true });

    // Create the pending breakpoints from edit mode on the server now.
    // Must happen before debugSessionStarted, so the process does not already
    // advance past the first "entry" stop before the breakpoints are set.
    const bpResults: Array<{ section: string; line: number; verified: boolean }> = [];
    const session = _debugSessions.get(panelKey)!;
    for (let i = 0; i < pendingBreakpoints.length; i++) {
      const bp = pendingBreakpoints[i];
      const bpId = session.nextBpId++;
      try {
        await client.addBreakpoint(state.id, processName, bp.section, bp.line, bpId);
        bpIds.set(bpKey(bp.section, bp.line), bpId);
        setSessionBpRule(session, bpKey(bp.section, bp.line), { condition: bp.condition, hitCondition: bp.hitCondition });
        bpResults.push({ section: bp.section, line: bp.line, verified: true });
      } catch {
        bpResults.push({ section: bp.section, line: bp.line, verified: false });
      }
    }

    postTo<HostToWebview>(panel.webview, { type: 'debugSessionStarted', debugId: state.id });
    for (const r of bpResults) {
      postTo<HostToWebview>(panel.webview, { type: 'breakpointVerified', section: r.section, line: r.line, verified: r.verified });
    }

    if (client.isEnded(state.status)) {
      // Process ended immediately — no breakpoint was hit. Let the user know
      // so they don't stare at a silent editor wondering what happened.
      const finalStatus = state.executeStatus ?? state.status;
      const errorLog = state.errorLog;
      const niceStatus = String(finalStatus || 'Beendet');
      if (errorLog && String(errorLog).trim() !== '') {
        vscode.window.showErrorMessage(vscode.l10n.t('Debug finished: {0}. {1}', niceStatus, errorLog));
      } else {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Debug ended: {0}. No breakpoint was reached — check the line and section of the breakpoint you set.', niceStatus)
        );
      }
      endSessionAllPanels(session, finalStatus, errorLog, panelKey);
    } else {
      // `tm1.Debug` normally returns once the process is parked, but a server
      // that answers `Running` must not be rendered as a pause — wait it out.
      if (state.status === 'Running') {
        const st = await waitForPauseOrEnd(panelKey, panel, session);
        if (!st) { return; }
        if (client.isEnded(st.status)) {
          endSessionAllPanels(session, st.executeStatus ?? st.status, st.errorLog, panelKey);
          return;
        }
      }
      // Paused — route highlight + variables to the right process editor.
      await emitPausedState(panelKey, panel, session);
      session.busy = false;
      // Keep the editor in step with the server for the rest of the session.
      startSessionSync(session);
    }
  } catch (err) {
    const message = errMsg(err);
    vscode.window.showErrorMessage(vscode.l10n.t('Debug start failed: {0}', message));
    postTo<HostToWebview>(panel.webview, {
      type: 'debugSessionEnded',
      status: 'Error',
      errorMessage: message,
    });
    const session = _debugSessions.get(panelKey);
    _debugSessions.delete(panelKey);
    // Without stop the ProcessDebugContext stays parked on TM1 and holds its
    // locks, and the stop button is gone.
    if (session) { void session.client.stop(session.debugId, processName).catch(() => undefined); }
  } finally {
    postTo<HostToWebview>(panel.webview, { type: 'setLoading', loading: false });
  }
}

/** Processes a breakpoint message from the webview. */
export async function handleBreakpoint(panelKey: string, panel: vscode.WebviewPanel, bp: BreakpointMessage): Promise<void> {
  const processName = processNameOf(panelKey);
  const session = _debugSessions.get(panelKey);
  if (!session) { return; }

  const key = bpKey(bp.section, bp.line);
  if (bp.enabled) {
    const bpId = session.nextBpId++;
    try {
      await session.client.addBreakpoint(session.debugId, processName, bp.section, bp.line, bpId);
      session.bpIds.set(key, bpId);
      postTo<HostToWebview>(panel.webview, { type: 'breakpointVerified', section: bp.section, line: bp.line, verified: true });
    } catch {
      postTo<HostToWebview>(panel.webview, { type: 'breakpointVerified', section: bp.section, line: bp.line, verified: false });
    }
  } else {
    const bpId = session.bpIds.get(key);
    if (bpId !== undefined) {
      try { await session.client.removeBreakpoint(session.debugId, bpId); } catch { /* best-effort cleanup; session may already be torn down */ }
      session.bpIds.delete(key);
      session.breakpoints.delete(key);
    }
  }
}

/** Live condition edit during a session: update the store only (the native TM1
 *  breakpoint is unchanged — conditions are evaluated host-side). */
export function handleBreakpointCondition(
  panelKey: string,
  bp: { section: string; line: number; condition: string; hitCondition?: string },
): void {
  const session = _debugSessions.get(panelKey);
  if (!session) { return; }
  const key = bpKey(bp.section, bp.line);
  setSessionBpRule(session, key, { condition: bp.condition, hitCondition: bp.hitCondition });
  const r = session.breakpoints.get(key);
  if (r) { r.hits = 0; } // restart counting when the rule changes mid-session
}

/** Ends a debug session and cleans up. */
export { cleanupDebugSession } from './debugSession';

/** Executes a debug command (step, continue, stop). */
export async function handleDebugCommand(panelKey: string, panel: vscode.WebviewPanel, command: string): Promise<void> {
  const session = _debugSessions.get(panelKey);
  if (!session) {
    // Never silent: the user pressed a button, so something must happen. Tell
    // the webview the truth so it leaves debug mode instead of sitting in a
    // paused state that no longer exists on the server.
    dbgLog(`[cmd] '${command}' from ${panelKey} discarded — no live debug session for this panel`);
    try {
      postTo<HostToWebview>(panel.webview, {
        type: 'debugSessionEnded',
        status: vscode.l10n.t('no active session'),
        errorMessage: vscode.l10n.t('Debug action "{0}" was discarded: this editor has no active debug session.', command),
      });
    } catch { /* panel disposed */ }
    return;
  }

  session.busy = true;
  try {
    // Dispatch command
    switch (command) {
      case 'stepOver': await session.client.stepOver(session.debugId); break;
      case 'stepIn': await session.client.stepIn(session.debugId); break;
      case 'stepOut': await session.client.stepOut(session.debugId); break;
      case 'continue': await session.client.continue(session.debugId); break;
      case 'stop':
        // End everywhere the session surfaced (StepIn opened sub-process panels).
        endSessionAllPanels(session, 'Stopped', undefined, panelKey);
        try { await session.client.stop(session.debugId, processNameOf(panelKey)); } catch { /* ignore stop errors */ }
        return;
    }

    // After step/continue: wait for a REAL pause (a poll timeout is not one),
    // then send the state update.
    const state = await waitForPauseOrEnd(panelKey, panel, session);
    if (!state) { return; }

    if (session.client.isEnded(state.status)) {
      dbgLog(`[end] status=${state.status} from ${panelKey} → notify panels ${JSON.stringify([...(session.touchedKeys ?? [])])}`);
      // Broadcast to every panel this session touched — a handed-off main editor
      // would otherwise stay stuck in debug mode after a sub-process finishes.
      endSessionAllPanels(session, state.executeStatus ?? state.status, state.errorLog, panelKey);
    } else {
      // Route highlight to the right process editor — may re-home the session
      // to a sub-process panel (StepIn) or back to the caller (StepOut).
      await emitPausedState(panelKey, panel, session);
    }
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Debug command failed: {0}', errMsg(err)));
    endSessionAllPanels(session, 'Error', errMsg(err), panelKey);
    void session.client.stop(session.debugId, processNameOf(panelKey)).catch(() => undefined);
  } finally {
    session.busy = false;
  }
}
