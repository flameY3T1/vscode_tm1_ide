/**
 * Regression tests for the "debugger stays on Prolog while TM1 has moved on"
 * class of bugs.
 *
 * All four cases share one root-cause pattern: the host inferred a debug state
 * it had never been told about (timeout ⇒ "paused", missing procedure ⇒
 * "Prolog", different casing ⇒ "foreign sub-process"), or told nobody at all
 * (cleanup). Each test drives the real code path with a fake DebugSession.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../debug/tm1DebugClient', async (orig) => ({ ...(await orig<typeof import('../debug/tm1DebugClient')>()), Tm1DebugClient: class {} }));
vi.mock('../commands/processEditor/openPanel', () => ({ openProcess: vi.fn() }));
vi.mock('../commands/processEditor/recentBridge', () => ({ recordProcessOpen: vi.fn() }));
vi.mock('../commands/serverManager', () => ({ getServerIdByUrl: vi.fn(() => 'srv-1') }));

import { handleDebugCommand } from '../commands/processEditor/debug';
import { cleanupDebugSession } from '../commands/processEditor/debugSession';
import { _debugSessions, _sessions, panelKey, sessionScope } from '../commands/processEditor/state';
import { testSession } from './helpers/processEditorSession';
import type { DebugSession } from '../commands/processEditor/state';
import type { Tm1DebugClient, StackFrame } from '../debug/tm1DebugClient';
import { openProcess } from '../commands/processEditor/openPanel';

const SERVER_KEY = 'http://tm1:8001';
const CONFIG = { serverUrl: SERVER_KEY, username: 'admin', password: 'p', authType: 'Basic' as const } as any;
const HOME_KEY = panelKey(sessionScope(CONFIG), 'MainProc');
const SUB_KEY = panelKey(sessionScope(CONFIG), 'SubProc');

function makePanel(): vscode.WebviewPanel {
  return {
    title: 'Test',
    webview: { postMessage: vi.fn().mockResolvedValue(true), html: '', onDidReceiveMessage: vi.fn() },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    reveal: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

function posted(panel: vscode.WebviewPanel): any[] {
  return (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
}

function makeSession(clientOverrides: Record<string, unknown> = {}, frame?: StackFrame): DebugSession {
  const client = {
    continue: vi.fn().mockResolvedValue(undefined),
    stepOver: vi.fn().mockResolvedValue(undefined),
    stepIn: vi.fn().mockResolvedValue(undefined),
    stepOut: vi.fn().mockResolvedValue(undefined),
    pollUntilPaused: vi.fn().mockResolvedValue({ status: 'Paused' }),
    getStatus: vi.fn().mockResolvedValue({ status: 'Paused' }),
    getCallStack: vi.fn().mockResolvedValue([frame ?? { id: '1', procedure: 'Data', lineNumber: 12 }]),
    getVariables: vi.fn().mockResolvedValue([]),
    isEnded: vi.fn((s: string) => s === 'Ended' || s === 'Complete' || s === 'Aborted'),
    stop: vi.fn().mockResolvedValue(undefined),
    ...clientOverrides,
  } as unknown as Tm1DebugClient;
  return {
    client,
    debugId: 'dbg-1',
    bpIds: new Map(),
    nextBpId: 0,
    breakpoints: new Map(),
    touchedKeys: new Set([HOME_KEY]),
    homeKey: HOME_KEY,
  };
}

function seedHome(session: DebugSession): vscode.WebviewPanel {
  const panel = makePanel();
  testSession(panel, HOME_KEY, 'MainProc', SERVER_KEY, CONFIG);
  _debugSessions.set(HOME_KEY, session);
  return panel;
}

beforeEach(() => {
  vi.clearAllMocks();
  _debugSessions.clear();
  _sessions.clear();
});

// ─── Fix 1 ────────────────────────────────────────────────────────────────────

describe('Fix 1 — a poll timeout is never rendered as a pause', () => {
  it('reports "running" and keeps polling until the process really pauses', async () => {
    const pollUntilPaused = vi.fn()
      // Deadline elapsed while the process was still running — NOT a pause.
      .mockResolvedValueOnce({ id: 'dbg-1', status: 'Running', timedOut: true })
      .mockResolvedValueOnce({ id: 'dbg-1', status: 'Running', timedOut: true })
      // Only now did TM1 actually park the process.
      .mockResolvedValueOnce({ id: 'dbg-1', status: 'Paused' });
    const session = makeSession({ pollUntilPaused });
    const panel = seedHome(session);

    await handleDebugCommand(HOME_KEY, panel, 'continue');

    expect(pollUntilPaused).toHaveBeenCalledTimes(3);
    const updates = posted(panel).filter((m) => m.type === 'debugStateUpdate');
    // The timeout produced a running state without an invented position …
    expect(updates[0]).toMatchObject({ status: 'running' });
    expect(updates[0].currentSection).toBeUndefined();
    expect(updates[0].currentLine).toBeUndefined();
    // … and only the real pause carried the highlight.
    expect(updates[updates.length - 1]).toMatchObject({ status: 'paused', currentSection: 'Data', currentLine: 12 });
    // A timed-out poll must not be reported as a finished session either.
    expect(posted(panel).some((m) => m.type === 'debugSessionEnded')).toBe(false);
  });

  it('abandons the poll loop once the session is cancelled (no orphaned loop)', async () => {
    let calls = 0;
    const session = makeSession();
    const pollUntilPaused = vi.fn().mockImplementation(async () => {
      calls++;
      // Simulate the stop button / panel dispose landing mid-flight.
      if (calls === 2) { session.cancelled = true; }
      return { id: 'dbg-1', status: 'Running', timedOut: true };
    });
    (session.client as any).pollUntilPaused = pollUntilPaused;
    const panel = seedHome(session);

    await handleDebugCommand(HOME_KEY, panel, 'stepOver');

    expect(pollUntilPaused).toHaveBeenCalledTimes(2);
    expect(posted(panel).some((m) => m.type === 'debugStateUpdate' && m.status === 'paused')).toBe(false);
  });
});

describe('server gone mid-debug — the session ends and TM1 is told to stop', () => {
  it('gives up after repeated unreachable polls instead of polling forever', async () => {
    const pollUntilPaused = vi.fn().mockResolvedValue({ id: 'dbg-1', status: 'Running', timedOut: true, pollError: 'ECONNREFUSED' });
    const session = makeSession({ pollUntilPaused });
    const panel = seedHome(session);

    await handleDebugCommand(HOME_KEY, panel, 'continue');

    expect(pollUntilPaused).toHaveBeenCalledTimes(2);
    expect(posted(panel).some((m) => m.type === 'debugSessionEnded')).toBe(true);
    expect(session.client.stop).toHaveBeenCalledWith('dbg-1', 'MainProc');
    expect(_debugSessions.has(HOME_KEY)).toBe(false);
  });

  it('a failing command still stops the debug context on TM1', async () => {
    const session = makeSession({ getCallStack: vi.fn().mockRejectedValue(new Error('socket hang up')) });
    const panel = seedHome(session);

    await handleDebugCommand(HOME_KEY, panel, 'stepOver');

    expect(posted(panel).some((m) => m.type === 'debugSessionEnded')).toBe(true);
    expect(session.client.stop).toHaveBeenCalledWith('dbg-1', 'MainProc');
  });
});

// ─── Fix 3 ────────────────────────────────────────────────────────────────────

describe('Fix 3 — cleanupDebugSession broadcasts to every touched panel', () => {
  it('notifies the handed-off main editor when the sub-process tab is closed', async () => {
    const session = makeSession();
    const homePanel = seedHome(session);
    const subPanel = makePanel();
    testSession(subPanel, SUB_KEY, 'SubProc', SERVER_KEY, CONFIG);
    // StepIn re-homed the session to the sub-process panel.
    _debugSessions.delete(HOME_KEY);
    _debugSessions.set(SUB_KEY, session);
    session.touchedKeys = new Set([HOME_KEY, SUB_KEY]);

    await cleanupDebugSession(SUB_KEY);

    // The main editor must leave debug mode instead of keeping a stale highlight.
    expect(posted(homePanel).some((m) => m.type === 'debugSessionEnded')).toBe(true);
    expect(posted(subPanel).some((m) => m.type === 'debugSessionEnded')).toBe(true);
    expect(_debugSessions.size).toBe(0);
    expect(session.client.stop).toHaveBeenCalled();
  });

  it('skips touched keys whose panel is already disposed', async () => {
    const session = makeSession();
    const homePanel = seedHome(session);
    // SUB_KEY was touched but its panel is gone (disposed) — must not throw.
    session.touchedKeys = new Set([HOME_KEY, SUB_KEY]);

    await expect(cleanupDebugSession(HOME_KEY)).resolves.toBeUndefined();
    expect(posted(homePanel).some((m) => m.type === 'debugSessionEnded')).toBe(true);
  });
});

// ─── Fix 4 ────────────────────────────────────────────────────────────────────

describe('Fix 4 — an unknown procedure is not turned into Prolog', () => {
  it('omits section and line when the server reports no position', async () => {
    // Server answered a frame without Procedure/LineNumber.
    const session = makeSession({}, { id: '1' } as StackFrame);
    const panel = seedHome(session);

    await handleDebugCommand(HOME_KEY, panel, 'stepOver');

    const paused = posted(panel).filter((m) => m.type === 'debugStateUpdate' && m.status === 'paused');
    expect(paused).toHaveLength(1);
    expect(paused[0]).not.toHaveProperty('currentSection');
    expect(paused[0]).not.toHaveProperty('currentLine');
  });
});

// ─── Fix 5 ────────────────────────────────────────────────────────────────────

describe('Fix 5 — process names compare case-insensitively', () => {
  it('treats the canonical server spelling as the same process (no bogus re-home)', async () => {
    // The panel key says 'MainProc' (what the user typed), TM1 answers 'MAINPROC'.
    const frame = { id: '1', procedure: 'Epilog', lineNumber: 4, processName: 'MAINPROC' } as StackFrame;
    const session = makeSession({}, frame);
    const panel = seedHome(session);

    await handleDebugCommand(HOME_KEY, panel, 'stepOver');

    // No second editor for "another" process; the session stays on its own key.
    expect(openProcess).not.toHaveBeenCalled();
    expect(_debugSessions.get(HOME_KEY)).toBe(session);
    expect(posted(panel).some((m) => m.type === 'debugStateUpdate' && m.status === 'paused' && m.currentSection === 'Epilog')).toBe(true);
  });

  it('still routes into a genuinely different process', async () => {
    const frame = { id: '1', procedure: 'Prolog', lineNumber: 7, processName: 'SubProc' } as StackFrame;
    const session = makeSession({}, frame);
    const panel = seedHome(session);
    vi.mocked(openProcess).mockImplementation(async () => {
      testSession(makePanel(), SUB_KEY, 'SubProc', SERVER_KEY, CONFIG);
      return true;
    });

    await handleDebugCommand(HOME_KEY, panel, 'stepIn');

    expect(openProcess).toHaveBeenCalledWith('SubProc', undefined, CONFIG);
    expect(_debugSessions.get(SUB_KEY)).toBe(session);
  });
});
