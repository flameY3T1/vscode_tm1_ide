import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('vscode', async () => await import('./__mocks__/vscode'));

import * as vscode from 'vscode';
import {
  startRun,
  finishRun,
  listRuns,
  cancelRun,
  onDidChangeRuns,
  dropRunsForServer,
  forgetRun,
  _clearRunsForTest,
} from '../runState/runRegistry';
import { formatElapsed } from '../runState/runningTreeProvider';
import { RecentTreeProvider } from '../recentTreeProvider';

/** Minimal ExtensionContext double — only globalState and extensionUri are read. */
function fakeContext(recent: unknown[] = []): any {
  let stored = recent;
  return {
    extensionUri: { fsPath: '/ext', scheme: 'file', path: '/ext' },
    globalState: {
      get: (_k: string, dflt: unknown) => stored ?? dflt,
      update: async (_k: string, v: unknown) => { stored = v as unknown[]; },
    },
  };
}

const baseInfo = {
  label: 'Running "load_sales"…',
  objectName: 'load_sales',
  kind: 'Processes' as const,
  cancel: () => { /* noop */ },
};

describe('runRegistry', () => {
  beforeEach(() => {
    _clearRunsForTest();
    vi.mocked(vscode.commands.executeCommand).mockClear();
  });

  it('lists a started run and drops it again on finish', () => {
    const id = startRun(baseInfo);
    expect(listRuns().map(r => r.objectName)).toEqual(['load_sales']);
    finishRun(id);
    expect(listRuns()).toEqual([]);
  });

  it('keeps runs in start order', () => {
    startRun({ ...baseInfo, objectName: 'first' });
    startRun({ ...baseInfo, objectName: 'second' });
    expect(listRuns().map(r => r.objectName)).toEqual(['first', 'second']);
  });

  it('fires the change event on start and on finish', () => {
    const seen = vi.fn();
    const sub = onDidChangeRuns(seen);
    const id = startRun(baseInfo);
    finishRun(id);
    sub.dispose();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('does not fire for an unknown id', () => {
    const seen = vi.fn();
    const sub = onDidChangeRuns(seen);
    finishRun('run#does-not-exist');
    sub.dispose();
    expect(seen).not.toHaveBeenCalled();
  });

  it('cancelRun leaves the entry in place — the server thread dies async', () => {
    const id = startRun(baseInfo);
    cancelRun(id);
    expect(listRuns()).toHaveLength(1);
  });

  it('ignores a cancel for a run that already finished', () => {
    const cancel = vi.fn();
    const id = startRun({ ...baseInfo, cancel });
    finishRun(id);
    cancelRun(id);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [5_000, '0:05'],
    [65_000, '1:05'],
    [600_000, '10:00'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('clamps a clock that jumped backwards', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});

describe('running executions inside the Recent view', () => {
  const recentItem = { kind: 'process', serverId: 's1', serverName: 'PROD', name: 'old_proc', ts: 1 };
  let provider: RecentTreeProvider;

  beforeEach(() => {
    _clearRunsForTest();
    vi.mocked(vscode.commands.executeCommand).mockClear();
    provider = new RecentTreeProvider(fakeContext([recentItem]));
  });

  afterEach(() => { provider.dispose(); });

  it('puts runs above the recent items — the reason they live here', () => {
    startRun(baseInfo);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(2);
    expect(provider.getTreeItem(roots[0]).label).toBe('load_sales');
    expect(provider.getTreeItem(roots[1]).label).toBe('old_proc');
  });

  it('shows the view for a run even with no history at all', () => {
    const empty = new RecentTreeProvider(fakeContext([]));
    vi.mocked(vscode.commands.executeCommand).mockClear();
    startRun(baseInfo);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'tm1.recent.hasItems', true);
    empty.dispose();
  });

  it('drops the run again when it finishes, leaving the history', () => {
    const id = startRun(baseInfo);
    finishRun(id);
    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(provider.getTreeItem(roots[0]).label).toBe('old_proc');
  });

  it('returns nothing below a run', () => {
    startRun(baseInfo);
    expect(provider.getChildren(provider.getChildren()[0])).toEqual([]);
  });

  it('still renders a recent item as an openable entry', () => {
    const ti = provider.getTreeItem(recentItem as never);
    expect(ti.contextValue).toBe('recent.process');
    expect(ti.command?.command).toBe('tm1.recent.open');
  });
});

describe('dropRunsForServer', () => {
  beforeEach(() => { _clearRunsForTest(); });

  const onA = { ...baseInfo, serverUrl: 'http://a:12357' };
  const onB = { ...baseInfo, objectName: 'other', serverUrl: 'http://b:12357' };

  it('fires exactly one change event, not one per dropped run', () => {
    startRun(onA); startRun(onA);
    let fired = 0;
    const sub = onDidChangeRuns(() => { fired++; });
    dropRunsForServer('http://a:12357');
    sub.dispose();
    expect(fired).toBe(1);
  });

  it('stays quiet when the server had no runs', () => {
    startRun(onB);
    let fired = 0;
    const sub = onDidChangeRuns(() => { fired++; });
    expect(dropRunsForServer('http://a:12357')).toBe(0);
    sub.dispose();
    expect(fired).toBe(0);
    expect(listRuns()).toHaveLength(1);
  });

  it('leaves a run without serverUrl standing — it cannot be assigned to any server', () => {
    startRun(baseInfo);
    expect(dropRunsForServer('http://a:12357')).toBe(0);
    expect(listRuns()).toHaveLength(1);
  });

  it('does not call the run cancel hook — the session is closed anyway', () => {
    // Cancelling would need a live session to find the thread.
    // After disconnecting, the attempt would go nowhere; the process keeps
    // running on TM1, only the display gives up on it.
    let cancelled = 0;
    startRun({ ...onA, cancel: () => { cancelled++; } });
    dropRunsForServer('http://a:12357');
    expect(cancelled).toBe(0);
  });
});

describe('forgetRun', () => {
  beforeEach(() => { _clearRunsForTest(); });

  it('fires the change event so sidebar and status bar follow', () => {
    const id = startRun(baseInfo);
    let fired = 0;
    const sub = onDidChangeRuns(() => { fired++; });
    forgetRun(id);
    sub.dispose();
    expect(fired).toBe(1);
  });

  it('reports false and stays quiet on an unknown id', () => {
    let fired = 0;
    const sub = onDidChangeRuns(() => { fired++; });
    expect(forgetRun('run#404')).toBe(false);
    sub.dispose();
    expect(fired).toBe(0);
  });

  it('does not fire the cancel hook — the connection it would need is gone', () => {
    let cancelled = 0;
    const id = startRun({ ...baseInfo, cancel: () => { cancelled++; } });
    forgetRun(id);
    expect(cancelled).toBe(0);
  });

  it('a late finishRun for the forgotten id is a no-op', () => {
    const id = startRun(baseInfo);
    forgetRun(id);
    let fired = 0;
    const sub = onDidChangeRuns(() => { fired++; });
    finishRun(id);
    sub.dispose();
    expect(fired).toBe(0);
  });
});
