import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { CalcNodeDTO } from '../../webviewClient/cellTrace/protocol';

const { traceRule, traceFeeders, checkFeeders } = vi.hoisted(() => ({
  traceRule: vi.fn(),
  traceFeeders: vi.fn(),
  checkFeeders: vi.fn(),
}));
vi.mock('../../tm1Rest/cellTraceApi', () => ({ traceRule, traceFeeders, checkFeeders }));

const { fetchRules } = vi.hoisted(() => ({
  fetchRules: vi.fn().mockResolvedValue(''),
}));
vi.mock('../../commands/rule/ruleEditor', () => ({
  fetchRules,
  RuleEditorManager: { open: vi.fn() },
}));

vi.mock('../../commands/cubeViewer/cellTracePanelHtml', () => ({
  getCellTraceHtml: () => '<html></html>',
}));

import { initializeCellTracePanel, openCellTracePanel } from '../../commands/cubeViewer/cellTracePanel';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const cfg = { serverUrl: 'https://s', username: 'u', authType: 'basic' } as unknown as Tm1Config;
const ROOT: CalcNodeDTO = {
  type: 'Rule', status: 'Data', value: 1, statements: [], tuple: [], components: [], childrenLoaded: true,
};

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function lastPanel(): any {
  const results = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results;
  return results[results.length - 1]!.value;
}

describe('cellTracePanel overlapping requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchRules.mockResolvedValue('');
    initializeCellTracePanel(vscode.Uri.file('/ext'));
  });

  it('newest request wins when the first resolves after the second', async () => {
    let resolveRule!: (v: CalcNodeDTO) => void;
    traceRule.mockImplementation(() => new Promise(r => { resolveRule = r; }));
    let resolveCheck!: (v: unknown[]) => void;
    checkFeeders.mockImplementation(() => new Promise(r => { resolveCheck = r; }));

    // Same cell → same panel key. Fresh coords so no panel from another test is reused.
    const args = { cube: 'C', dims: ['D'], coords: ['E1'], config: cfg };
    const p1 = openCellTracePanel({ kind: 'rule', ...args });
    const panel = lastPanel();
    const p2 = openCellTracePanel({ kind: 'check', ...args });
    await flush(); // let p1 pass its fetchRules await and reach traceRule

    expect(traceRule).toHaveBeenCalledTimes(1);
    expect(checkFeeders).toHaveBeenCalledTimes(1);

    // Second request resolves FIRST …
    resolveCheck([]);
    await p2;
    // … then the first (now stale) request resolves.
    resolveRule(ROOT);
    await p1;

    const posts = panel.webview.postMessage.mock.calls.map((c: any[]) => c[0]);
    // The stale ruleResult must never be posted.
    expect(posts.some((m: any) => m.type === 'ruleResult')).toBe(false);
    // The final data message is the newest request's result.
    const dataPosts = posts.filter((m: any) => m.type !== 'loading');
    expect(dataPosts).toHaveLength(1);
    expect(dataPosts[0].type).toBe('checkResult');
  });

  it('re-traces the same cell in the requested mode on a tab switch', async () => {
    traceRule.mockResolvedValue(ROOT);
    traceFeeders.mockResolvedValue({ statements: [], fedCells: [] });

    await openCellTracePanel({ kind: 'rule', cube: 'C', dims: ['D'], coords: ['E9'], config: cfg });
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();

    panel.simulateMessage({ type: 'switchMode', kind: 'feeders' });
    await flush();
    await flush();

    // Same cell, other mode — and it must land in THIS panel, not a new one.
    expect(traceFeeders).toHaveBeenCalledWith('C', ['D'], ['E9'], cfg);
    const posts = panel.webview.postMessage.mock.calls.map((c: any[]) => c[0]);
    expect(posts[0]).toEqual({ type: 'loading', kind: 'feeders' });
    expect(posts.some((m: any) => m.type === 'feedersResult')).toBe(true);
  });

  it('drops the response silently when the panel is disposed mid-flight', async () => {
    let resolveRule!: (v: CalcNodeDTO) => void;
    traceRule.mockImplementation(() => new Promise(r => { resolveRule = r; }));

    const p1 = openCellTracePanel({ kind: 'rule', cube: 'C', dims: ['D'], coords: ['E2'], config: cfg });
    const panel = lastPanel();
    await flush();

    // Capture the live spy first: after dispose, `panel.webview` is the silent
    // replacement from `muteWebviewOnDispose`, not the mock.
    const post = panel.webview.postMessage;
    panel.dispose(); // user closes the panel while the trace is in flight
    resolveRule(ROOT);
    await expect(p1).resolves.toBeUndefined(); // no throw from posting to a disposed webview

    const posts = post.mock.calls.map((c: any[]) => c[0]);
    expect(posts.every((m: any) => m.type === 'loading')).toBe(true);
  });

  it('a lone request still posts its result (guard does not over-drop)', async () => {
    traceFeeders.mockResolvedValue({ statements: [], fedCells: [] });

    await openCellTracePanel({ kind: 'feeders', cube: 'C', dims: ['D'], coords: ['E3'], config: cfg });
    const panel = lastPanel();

    const posts = panel.webview.postMessage.mock.calls.map((c: any[]) => c[0]);
    expect(posts[posts.length - 1].type).toBe('feedersResult');
  });
});
