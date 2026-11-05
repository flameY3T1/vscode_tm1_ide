// Host side of the TI console: the only message path that executes arbitrary TI
// on the server. The test checks what goes to the server during a run, what
// comes back into the window and what ends up in the history — also on cancel
// and when TM1 never gets to execute at all (review 2026-09-23, W7).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as vscode from 'vscode';

const runTransientProcess = vi.hoisted(() => vi.fn());
const runCancellableProcess = vi.hoisted(() => vi.fn());

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../tm1Rest/transientProcess', () => ({ runTransientProcess }));
vi.mock('../runState/runCancellableProcess', () => ({ runCancellableProcess }));
vi.mock('../providers/contextListFetch', () => ({
  fetchCubeNames: vi.fn(async () => ['Sales']),
  fetchCubesWithDims: vi.fn(async () => []),
  fetchDimensionNames: vi.fn(async () => []),
  fetchHierarchyNamesFor: vi.fn(async () => []),
  fetchProcessList: vi.fn(async () => []),
}));

import { TiConsolePanel } from '../webviews/tiConsoleWebview';
import { TI_CONSOLE_HISTORY_KEY } from '../serverState/stateKeys';

const CFG = { serverUrl: 'http://tm1:1234' } as never;

function memento(): vscode.ExtensionContext {
  const data = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string) => data.get(k),
      update: async (k: string, v: unknown) => { data.set(k, v); },
      keys: () => [...data.keys()],
    },
  } as unknown as vscode.ExtensionContext;
}

async function send(msg: unknown): Promise<Array<Record<string, unknown>>> {
  const posted: Array<Record<string, unknown>> = [];
  const panel = { webview: { postMessage: (m: Record<string, unknown>) => { posted.push(m); } } };
  await (TiConsolePanel as unknown as {
    onMessage(m: unknown, p: unknown, c: unknown): Promise<void>;
  }).onMessage(msg, panel, CFG);
  return posted;
}

function history(): Array<{ code: string; ok: boolean; status: string; timestamp: number }> {
  const all = TiConsolePanel.memento!.globalState.get<Record<string, never[]>>(TI_CONSOLE_HISTORY_KEY) ?? {};
  return all['http://tm1:1234'] ?? [];
}

beforeEach(() => {
  runTransientProcess.mockReset();
  runCancellableProcess.mockReset();
  // The cancellation frame really calls the run — that way the test sees what goes to the server.
  runCancellableProcess.mockImplementation(async (_t, _n, _c, run: () => Promise<unknown>) => ({ result: await run(), cancelled: false }));
  TiConsolePanel.memento = memento();
});

describe('TiConsolePanel.onMessage', () => {
  it('runs the snippet terminated, under a transient name, and records it', async () => {
    runTransientProcess.mockResolvedValue({ ok: true, status: 'CompletedSuccessfully' });
    const out = await send({ type: 'run', code: "x = 1" });

    expect(runTransientProcess).toHaveBeenCalledTimes(1);
    const [cfg, proc] = runTransientProcess.mock.calls[0];
    expect(cfg).toBe(CFG);
    expect(proc.prolog).toBe('x = 1;');
    expect(proc.name).toMatch(/^\}VSCode_TIConsole_/);
    // The cancel lookup recognises the run only by the function, not by the name.
    expect(runCancellableProcess.mock.calls[0][4]).toEqual({ includeTransient: true });

    expect(out[0]).toMatchObject({ type: 'result', ok: true, status: 'CompletedSuccessfully' });
    expect(out[1]).toMatchObject({ type: 'historyUpdate' });
    expect(history()).toMatchObject([{ code: 'x = 1', ok: true }]);
  });

  it('reports a cancelled run and keeps it out of the history', async () => {
    runCancellableProcess.mockResolvedValue({ result: undefined, cancelled: true });
    const out = await send({ type: 'run', code: 'x = 1;' });
    expect(out).toEqual([{ type: 'cancelled' }]);
    expect(history()).toEqual([]);
  });

  it('reports a failure before execution and still records the snippet', async () => {
    runTransientProcess.mockRejectedValue(new Error('Syntax error on line 1'));
    const out = await send({ type: 'run', code: 'x = ;' });
    expect(out[0]).toEqual({ type: 'failed', message: 'Syntax error on line 1' });
    expect(history()).toMatchObject([{ code: 'x = ;', ok: false, status: 'Syntax error on line 1' }]);
  });

  it('deletes a history entry by timestamp, not by position', async () => {
    await TiConsolePanel.memento!.globalState.update(TI_CONSOLE_HISTORY_KEY, {
      'http://tm1:1234': [
        { code: 'a', timestamp: 2, elapsedMs: 1, ok: true, status: '' },
        { code: 'b', timestamp: 1, elapsedMs: 1, ok: true, status: '' },
      ],
    });
    await send({ type: 'deleteHistoryEntry', timestamp: 1 });
    expect(history().map(e => e.code)).toEqual(['a']);
    // Unknown timestamp: write nothing, report nothing.
    expect(await send({ type: 'deleteHistoryEntry', timestamp: 99 })).toEqual([]);
  });

  it('answers the handshake with the stored history and object requests with lists', async () => {
    expect(await send({ type: 'webviewReady' })).toEqual([{ type: 'historyUpdate', entries: [] }]);
    expect(await send({ type: 'fetchCubes' })).toEqual([{ type: 'cubeList', cubes: ['Sales'] }]);
  });
});
