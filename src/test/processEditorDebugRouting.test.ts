/**
 * StepIn routing in `emitPausedState` (debug.ts).
 *
 * Drives the real routing path via `handleDebugCommand` with a fake
 * DebugSession whose top stack frame lives in a DIFFERENT process than the
 * panel the session started on — that is the StepIn-into-sub-process case.
 *
 * Focus: the "Recently opened" entry must only be written when the
 * sub-process editor actually opened. `openPanel.openProcess` swallows load
 * errors (toast + dispose), so awaiting it proves nothing; the authoritative
 * signal is whether `_sessions` holds the target key afterwards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../debug/tm1DebugClient', async (orig) => ({ ...(await orig<typeof import('../debug/tm1DebugClient')>()), Tm1DebugClient: class {} }));
vi.mock('../commands/processEditor/openPanel', () => ({ openProcess: vi.fn() }));
vi.mock('../commands/processEditor/recentBridge', () => ({ recordProcessOpen: vi.fn() }));
vi.mock('../commands/serverManager', () => ({ getServerIdByUrl: vi.fn() }));

import { handleDebugCommand } from '../commands/processEditor/debug';
import { _debugSessions, _sessions, panelKey, sessionScope } from '../commands/processEditor/state';
import { testSession } from './helpers/processEditorSession';
import type { DebugSession } from '../commands/processEditor/state';
import type { Tm1DebugClient, StackFrame } from '../debug/tm1DebugClient';
import { openProcess } from '../commands/processEditor/openPanel';
import { recordProcessOpen } from '../commands/processEditor/recentBridge';
import { getServerIdByUrl } from '../commands/serverManager';

const SERVER_KEY = 'http://tm1:8001';
const CONFIG = { serverUrl: SERVER_KEY, username: 'admin', password: 'p', authType: 'Basic' as const } as any;
const HOME_KEY = panelKey(sessionScope(CONFIG), 'MainProc');
const TARGET_KEY = panelKey(sessionScope(CONFIG), 'SubProc');

function makePanel(): vscode.WebviewPanel {
  return {
    title: 'Test',
    webview: {
      postMessage: vi.fn().mockResolvedValue(true),
      html: '',
      onDidReceiveMessage: vi.fn(),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    reveal: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

/** Top frame reports a different process → StepIn descended into SubProc. */
const subProcFrame = {
  id: '1', procedure: 'Prolog', lineNumber: 7, processName: 'SubProc',
} as unknown as StackFrame;

function makeSession(): DebugSession {
  const client = {
    continue: vi.fn().mockResolvedValue(undefined),
    stepIn: vi.fn().mockResolvedValue(undefined),
    pollUntilPaused: vi.fn().mockResolvedValue({ status: 'paused' }),
    isEnded: vi.fn().mockReturnValue(false),
    getCallStack: vi.fn().mockResolvedValue([subProcFrame]),
    getVariables: vi.fn().mockResolvedValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
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

function postedTypes(panel: vscode.WebviewPanel): string[] {
  return (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as any).type);
}

function seedHomePanel(): vscode.WebviewPanel {
  const homePanel = makePanel();
  testSession(homePanel, HOME_KEY, 'MainProc', SERVER_KEY, CONFIG);
  _debugSessions.set(HOME_KEY, makeSession());
  return homePanel;
}

beforeEach(() => {
  vi.clearAllMocks();
  _debugSessions.clear();
  _sessions.clear();
  vi.mocked(getServerIdByUrl).mockReturnValue('srv-1');
});

describe('emitPausedState — StepIn into a sub-process', () => {
  it('records the sub-process in "Recently opened" once its editor is open', async () => {
    const homePanel = seedHomePanel();
    const subPanel = makePanel();
    // A successful open registers the panel — mirror that.
    vi.mocked(openProcess).mockImplementation(async () => {
      testSession(subPanel, TARGET_KEY, 'SubProc', SERVER_KEY, CONFIG);
      return true;
    });

    await handleDebugCommand(HOME_KEY, homePanel, 'stepIn');

    expect(openProcess).toHaveBeenCalledWith('SubProc', undefined, CONFIG);
    expect(recordProcessOpen).toHaveBeenCalledWith('srv-1', 'SubProc');
  });

  it('records NOTHING when the sub-process editor failed to open', async () => {
    const homePanel = seedHomePanel();
    // openProcess shows its error toast, disposes the panel and returns — no
    // entry in _sessions. Nothing opened, so nothing may be recorded.
    vi.mocked(openProcess).mockResolvedValue(false);

    await handleDebugCommand(HOME_KEY, homePanel, 'stepIn');

    expect(openProcess).toHaveBeenCalledWith('SubProc', undefined, CONFIG);
    expect(recordProcessOpen).not.toHaveBeenCalled();
    // Fallback path still shows the paused state on the current panel.
    expect(postedTypes(homePanel)).toContain('debugStateUpdate');
  });

  it('records NOTHING when opening the sub-process editor throws', async () => {
    const homePanel = seedHomePanel();
    vi.mocked(openProcess).mockRejectedValue(new Error('boom'));

    await handleDebugCommand(HOME_KEY, homePanel, 'stepIn');

    expect(recordProcessOpen).not.toHaveBeenCalled();
    expect(postedTypes(homePanel)).toContain('debugStateUpdate');
  });
});
