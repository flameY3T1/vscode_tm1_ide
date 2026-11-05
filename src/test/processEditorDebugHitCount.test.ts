/**
 * Host-side hit-count filter tests.
 *
 * Drives the real advanceToPausableStop loop (via handleDebugCommand) by
 * injecting a fake DebugSession into _debugSessions and a fake WebviewPanel.
 * The fake client always reports a stop at the same Prolog:5 line so the
 * hit-counter advances on every qualifying (condition-true) stop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// Mock modules that the real debug.ts imports but we don't want real network calls from.
vi.mock('../debug/tm1DebugClient', async (orig) => ({ ...(await orig<typeof import('../debug/tm1DebugClient')>()), Tm1DebugClient: class {} }));
vi.mock('../commands/processEditor/openPanel', () => ({ openProcess: vi.fn() }));

import { handleDebugCommand, handleBreakpointCondition } from '../commands/processEditor/debug';
import {
  _debugSessions,
  _sessions,
  bpKey,
  setSessionBpRule,
} from '../commands/processEditor/state';
import type { DebugSession } from '../commands/processEditor/state';
import type { Tm1DebugClient } from '../debug/tm1DebugClient';
import { testSession } from './helpers/processEditorSession';
import type { StackFrame, TiVariable } from '../debug/tm1DebugClient';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PANEL_KEY = '__default__|HitCountTest';

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
    active: true,
    visible: true,
    viewType: 'processEditor',
    options: {},
  } as unknown as vscode.WebviewPanel;
}

type FakeClient = Tm1DebugClient & {
  continue: ReturnType<typeof vi.fn>;
  pollUntilPaused: ReturnType<typeof vi.fn>;
  getCallStack: ReturnType<typeof vi.fn>;
  getVariables: ReturnType<typeof vi.fn>;
  isEnded: ReturnType<typeof vi.fn>;
  stepOver: ReturnType<typeof vi.fn>;
  stepIn: ReturnType<typeof vi.fn>;
  stepOut: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

/** Create a fake client that always stops at Prolog:5. */
function makeFakeClient(vars: TiVariable[] = []): FakeClient {
  const frame: StackFrame = { id: '1', procedure: 'Prolog', lineNumber: 5 };
  return {
    continue: vi.fn().mockResolvedValue(undefined),
    pollUntilPaused: vi.fn().mockResolvedValue({ status: 'paused', executeStatus: undefined, errorLog: undefined }),
    getCallStack: vi.fn().mockResolvedValue([frame]),
    getVariables: vi.fn().mockResolvedValue(vars),
    isEnded: vi.fn().mockReturnValue(false),
    stepOver: vi.fn().mockResolvedValue(undefined),
    stepIn: vi.fn().mockResolvedValue(undefined),
    stepOut: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as FakeClient;
}

function makeSession(client: FakeClient): DebugSession {
  return {
    client: client as unknown as Tm1DebugClient,
    debugId: 'dbg-001',
    bpIds: new Map(),
    nextBpId: 0,
    breakpoints: new Map(),
    touchedKeys: new Set([PANEL_KEY]),
    homeKey: PANEL_KEY,
  };
}

function postedTypes(panel: vscode.WebviewPanel): string[] {
  return (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as any).type);
}

function lastPosted(panel: vscode.WebviewPanel): any {
  const calls = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls;
  return calls.length > 0 ? calls[calls.length - 1][0] : undefined;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _debugSessions.clear();
  _sessions.clear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hit-count filter in advanceToPausableStop', () => {
  it('>=3: auto-continues twice, pauses on 3rd qualifying stop', async () => {
    const client = makeFakeClient();
    const session = makeSession(client);
    setSessionBpRule(session, bpKey('Prolog', 5), { hitCondition: '>=3' });
    _debugSessions.set(PANEL_KEY, session);
    const panel = makePanel();
    testSession(panel, PANEL_KEY, 'HitCountTest', '__default__');

    await handleDebugCommand(PANEL_KEY, panel, 'continue');

    // Initial user-continue + 2 auto-continues in the loop = 3 total.
    expect(client.continue).toHaveBeenCalledTimes(3);
    // Hit counter should be at 3.
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(3);
    // Final message is a pause (debugStateUpdate).
    expect(lastPosted(panel)).toMatchObject({ type: 'debugStateUpdate', status: 'paused' });
  });

  it('%2: skips odd hits, pauses on 2nd and 4th', async () => {
    const client = makeFakeClient();
    const session = makeSession(client);
    setSessionBpRule(session, bpKey('Prolog', 5), { hitCondition: '%2' });
    _debugSessions.set(PANEL_KEY, session);
    const panel = makePanel();
    testSession(panel, PANEL_KEY, 'HitCountTest', '__default__');

    // First handleDebugCommand call: hits 1 (skip) then pauses at hit 2.
    await handleDebugCommand(PANEL_KEY, panel, 'continue');

    // client.continue: 1 (user) + 1 (loop skip hit-1) = 2.
    expect(client.continue).toHaveBeenCalledTimes(2);
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(2);
    expect(lastPosted(panel)).toMatchObject({ type: 'debugStateUpdate', status: 'paused' });

    vi.clearAllMocks();

    // Second handleDebugCommand: hit 3 (skip), hit 4 (pause).
    await handleDebugCommand(PANEL_KEY, panel, 'continue');

    expect(client.continue).toHaveBeenCalledTimes(2); // user + 1 loop skip
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(4);
    expect(lastPosted(panel)).toMatchObject({ type: 'debugStateUpdate', status: 'paused' });
  });

  it('=2: auto-continues on 1st hit, pauses on 2nd', async () => {
    const client = makeFakeClient();
    const session = makeSession(client);
    setSessionBpRule(session, bpKey('Prolog', 5), { hitCondition: '=2' });
    _debugSessions.set(PANEL_KEY, session);
    const panel = makePanel();
    testSession(panel, PANEL_KEY, 'HitCountTest', '__default__');

    await handleDebugCommand(PANEL_KEY, panel, 'continue');

    // Hit 1 skipped (=2 not yet), hit 2 pauses. continue: 1(user) + 1(loop) = 2.
    expect(client.continue).toHaveBeenCalledTimes(2);
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(2);
    expect(lastPosted(panel)).toMatchObject({ type: 'debugStateUpdate', status: 'paused' });
  });

  it('expression false does NOT advance the hit counter; 2nd expression-true stop is the pause', async () => {
    // vN <= 10 on first stop (expression false) → no hit advance.
    // vN > 10 on subsequent stops → expression true → hit-count applies.
    let callCount = 0;
    const frame: StackFrame = { id: '1', procedure: 'Prolog', lineNumber: 5 };
    const client = makeFakeClient();
    // First getVariables call: vN=5 (expression false).
    // Subsequent calls: vN=20 (expression true).
    client.getVariables = vi.fn().mockImplementation(() => {
      callCount++;
      const val = callCount === 1 ? '5' : '20';
      return Promise.resolve([{ name: 'vN', value: val }]);
    });
    client.getCallStack = vi.fn().mockResolvedValue([frame]);

    const session = makeSession(client);
    setSessionBpRule(session, bpKey('Prolog', 5), { condition: 'vN > 10', hitCondition: '>=2' });
    _debugSessions.set(PANEL_KEY, session);
    const panel = makePanel();
    testSession(panel, PANEL_KEY, 'HitCountTest', '__default__');

    await handleDebugCommand(PANEL_KEY, panel, 'continue');

    // Stop 1: vN=5, expression false → no hit advance → auto-continue.
    // Stop 2: vN=20, expression true → hit=1 → >=2 not satisfied → auto-continue.
    // Stop 3: vN=20, expression true → hit=2 → >=2 satisfied → pause.
    // continues: 1(user) + 1(expr-false) + 1(hit-1-skip) = 3.
    expect(client.continue).toHaveBeenCalledTimes(3);
    // Hit counter must be 2 (only expression-true stops count).
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(2);
    expect(lastPosted(panel)).toMatchObject({ type: 'debugStateUpdate', status: 'paused' });
  });

  it('handleBreakpointCondition: resets hit counter so next qualifying stop counts as hit #1', async () => {
    const client = makeFakeClient();
    const session = makeSession(client);
    setSessionBpRule(session, bpKey('Prolog', 5), { hitCondition: '>=2' });
    _debugSessions.set(PANEL_KEY, session);
    const panel = makePanel();
    testSession(panel, PANEL_KEY, 'HitCountTest', '__default__');

    // Drive to first pause: hits=2, pauses on 2nd qualifying stop.
    await handleDebugCommand(PANEL_KEY, panel, 'continue');
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(2);

    // Change the hit spec mid-session — must reset the counter.
    handleBreakpointCondition(PANEL_KEY, { section: 'Prolog', line: 5, condition: '', hitCondition: '>=2' });
    expect(session.breakpoints.get(bpKey('Prolog', 5))?.hits).toBe(0);
  });

  it('invalid hit spec: pauses on first stop, posts breakpointConditionError', async () => {
    const client = makeFakeClient();
    const session = makeSession(client);
    setSessionBpRule(session, bpKey('Prolog', 5), { hitCondition: 'abc' });
    _debugSessions.set(PANEL_KEY, session);
    const panel = makePanel();
    testSession(panel, PANEL_KEY, 'HitCountTest', '__default__');

    await handleDebugCommand(PANEL_KEY, panel, 'continue');

    // Should pause immediately (fail-safe) on first stop. Only user-continue fires.
    expect(client.continue).toHaveBeenCalledTimes(1);
    const types = postedTypes(panel);
    expect(types).toContain('breakpointConditionError');
    expect(types).toContain('debugStateUpdate');
    // Error message should mention the invalid spec.
    const errMsg = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => c[0].type === 'breakpointConditionError')?.[0];
    expect(errMsg?.message).toMatch(/invalid hit count/i);
  });
});
