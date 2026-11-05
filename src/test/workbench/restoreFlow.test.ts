import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { SavedWindow, WindowKind, ReopenContext } from '../../commands/workbench/windowKinds';
import type { Workbench } from '../../commands/workbench/workbenchStore';

vi.mock('../../commands/workbench/windowKinds', () => ({
  kindOf: vi.fn(),
}));

import { kindOf } from '../../commands/workbench/windowKinds';
import { restoreWorkbench } from '../../commands/workbench/restoreFlow';

const CFG: Tm1Config = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic',
};

const RCTX: ReopenContext = {
  serverId: 'srv-1',
  serverLabel: 'Test Server',
  extensionContext: {} as never,
  refreshTree: vi.fn(),
};

function wb(windows: SavedWindow[]): Workbench {
  return { id: 'wb-1', serverId: 'srv-1', name: 'Quartal', savedAt: 0, windows };
}

function kind(label: string, reopen: WindowKind['reopen']): WindowKind {
  return { group: () => '', label: () => label, reopen };
}

beforeEach(() => {
  vi.mocked(kindOf).mockReset();
  vi.mocked(vscode.window.showWarningMessage).mockClear();
  vi.mocked(vscode.window.showInformationMessage).mockClear();
});

describe('restoreWorkbench', () => {
  it('opens windows one after another — no reopen starts before the previous one finished', async () => {
    const log: string[] = [];
    const windows: SavedWindow[] = [{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }];

    vi.mocked(kindOf).mockImplementation((name: string) =>
      kind(name, async (w) => {
        log.push(`start:${w.kind}`);
        await new Promise(resolve => setTimeout(resolve, 0));
        log.push(`end:${w.kind}`);
      }),
    );

    await restoreWorkbench(wb(windows), CFG, RCTX);

    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('does not abort on a failing reopen — the remaining windows still open', async () => {
    const calls: string[] = [];
    const windows: SavedWindow[] = [{ kind: 'broken' }, { kind: 'ok' }];

    vi.mocked(kindOf).mockImplementation((name: string) => {
      if (name === 'broken') {
        return kind('Broken', async () => {
          calls.push('broken');
          throw new Error('cube no longer exists');
        });
      }
      return kind('Ok', async () => { calls.push('ok'); });
    });

    await restoreWorkbench(wb(windows), CFG, RCTX);

    expect(calls).toEqual(['broken', 'ok']);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    const text = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0] as string;
    expect(text).toContain('1 of 2');
    expect(text).toContain('Broken (cube no longer exists)');
  });

  it('reports a kind without a way back instead of skipping it silently', async () => {
    const calls: string[] = [];
    const windows: SavedWindow[] = [{ kind: 'tm1FromALaterVersion', target: 'Umsatz' }, { kind: 'ok' }];

    vi.mocked(kindOf).mockImplementation((name: string) => {
      if (name === 'ok') { return kind('Ok', async () => { calls.push('ok'); }); }
      return { group: () => 'Other', label: (w: SavedWindow) => w.target ?? w.kind };
    });

    await restoreWorkbench(wb(windows), CFG, RCTX);

    expect(calls).toEqual(['ok']);
    const text = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0] as string;
    expect(text).toContain('1 of 2');
    expect(text).toContain('Umsatz (window type unknown in this version)');
  });
});

// ── The saved state is applied to the fresh window ─────────────────────────
// ── Cancelling ─────────────────────────────────────────────────────────────
// Up to MAX_WINDOWS windows one after the other, each with REST traffic: without
// cancellation the user could only watch.
describe('restoreWorkbench: cancelling', () => {
  /** Progress display with a flag that the test can flip itself. */
  function withCancellableProgress() {
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) };
    vi.mocked(vscode.window.withProgress).mockImplementationOnce(
      async (_options: any, task: any) => await task({ report: vi.fn() }, token),
    );
    return token;
  }

  it('registers the progress display as cancellable', async () => {
    vi.mocked(kindOf).mockImplementation((name: string) => kind(name, async () => {}));
    await restoreWorkbench(wb([{ kind: 'a' }]), CFG, RCTX);
    const options = vi.mocked(vscode.window.withProgress).mock.calls.at(-1)![0] as any;
    expect(options.cancellable).toBe(true);
  });

  it('does not start the remaining windows after cancellation', async () => {
    const token = withCancellableProgress();
    const opened: string[] = [];
    vi.mocked(kindOf).mockImplementation((name: string) =>
      kind(name.toUpperCase(), async (w) => {
        opened.push(w.kind);
        token.isCancellationRequested = true; // user cancels after the first window
      }),
    );

    await restoreWorkbench(wb([{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }]), CFG, RCTX);

    expect(opened).toEqual(['a']);
  });

  it('names the cancelled windows instead of sweeping them under the rug', async () => {
    const token = withCancellableProgress();
    vi.mocked(kindOf).mockImplementation((name: string) =>
      kind(name.toUpperCase(), async () => { token.isCancellationRequested = true; }),
    );

    await restoreWorkbench(wb([{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }]), CFG, RCTX);

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    const text = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0] as string;
    expect(text).toContain('1 of 3');
    expect(text).toContain('Cancelled, not opened: B, C');
    // A cancellation is not a failure — it must not appear in the error list.
    expect(text).not.toContain('Not opened: B');
  });
});

describe('restoreWorkbench: applying the state', () => {
  it('applies the shell when the kind has a contract for it', async () => {
    const { registerWindow, clearWindowsForTest } = await import('../../workbench/windowRegistry');
    clearWindowsForTest();
    const posted: unknown[] = [];
    const panel = {
      webview: { postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true); } },
      reveal: () => {},
    };
    const applied: SavedWindow[] = [];
    vi.mocked(kindOf).mockImplementation(() => ({
      group: () => '', label: () => 'Kunde',
      reopen: async () => {
        registerWindow({ kind: 'tm1DimensionBrowser', rawKey: 'k', panel, serverId: CFG.serverUrl, target: 'Kunde' });
      },
      applyState: (p, w) => {
        applied.push(w);
        (p as unknown as typeof panel).webview.postMessage({ type: 'applyState', compose: w.state });
      },
    }));
    await restoreWorkbench(
      wb([{ kind: 'tm1DimensionBrowser', target: 'Kunde', state: { hierarchy: 'H' } }]), CFG, RCTX,
    );
    expect(applied).toHaveLength(1);
    expect(posted).toEqual([{ type: 'applyState', compose: { hierarchy: 'H' } }]);
    clearWindowsForTest();
  });

  it('considers the window restored even if applying throws', async () => {
    // The shell is an extra. If it fails, the window still stands —
    // and the summary must not report it as a failure.
    vi.mocked(kindOf).mockImplementation(() => ({
      group: () => '', label: () => 'X',
      reopen: async () => {},
      applyState: () => { throw new Error('Webview is disposed'); },
    }));
    await restoreWorkbench(wb([{ kind: 'x' }]), CFG, RCTX);
    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalled();
    expect(vi.mocked(vscode.window.showWarningMessage)).not.toHaveBeenCalled();
  });

  it('does not fall over when the first window is already disposed when revealed', async () => {
    // `panel?.reveal()` protects against MISSING, not against DISPOSED — and a
    // throw here used to take the summary down with it.
    const { registerWindow, clearWindowsForTest } = await import('../../workbench/windowRegistry');
    clearWindowsForTest();
    const tot = { reveal: () => { throw new Error('Webview is disposed'); } };
    vi.mocked(kindOf).mockImplementation(() => ({
      group: () => '', label: () => 'Y',
      reopen: async () => {
        registerWindow({ kind: 'y', rawKey: 'k', panel: tot, serverId: CFG.serverUrl, target: 'Y' });
      },
    }));
    await expect(restoreWorkbench(wb([{ kind: 'y', target: 'Y' }]), CFG, RCTX)).resolves.toBeUndefined();
    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalled();
    clearWindowsForTest();
  });
});

/**
 * A broken window costs one window, not the whole run.
 *
 * Until 2026-08-25, `kindOf(w.kind)` and `kind.label(w)` stood BEFORE the
 * `try` block. An entry from the store that does not have the expected shape
 * — `null`, a string, or a `kind: "toString"` that yields a non-kind via the
 * prototype chain — let the TypeError run all the way into the
 * `withProgress` chain. The run aborted; the remaining windows did not
 * even open, and the summary message, which exists exactly for this, never came
 * (review 2026-08-24, H4).
 */
describe('restoreWorkbench: a broken window', () => {
  it('does not stop the run when `label` throws', async () => {
    const opened: string[] = [];
    vi.mocked(kindOf).mockImplementation((name: string) => (name === 'kaputt'
      ? ({ group: () => '', label: () => { throw new TypeError('kind.label is not a function'); },
           reopen: async () => {} } as unknown as WindowKind)
      : kind(name.toUpperCase(), async (w) => { opened.push(w.kind); })));

    await restoreWorkbench(wb([{ kind: 'a' }, { kind: 'kaputt' }, { kind: 'c' }]), CFG, RCTX);

    // The healthy ones open — both, including the one AFTER the broken one.
    expect(opened).toEqual(['a', 'c']);
    // And there is a message instead of a silent abort.
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('does not stop the run when `kindOf` itself throws', async () => {
    const opened: string[] = [];
    vi.mocked(kindOf).mockImplementation((name: string) => {
      if (name === 'kaputt') { throw new TypeError('kaputter Eintrag'); }
      return kind(name.toUpperCase(), async (w) => { opened.push(w.kind); });
    });

    await restoreWorkbench(wb([{ kind: 'a' }, { kind: 'kaputt' }, { kind: 'c' }]), CFG, RCTX);

    expect(opened).toEqual(['a', 'c']);
  });

  it('survives a window that is not an object at all', async () => {
    // Something like this comes from `globalState`, not from the program. The store
    // filters it by now, but the run must not rely on that.
    const opened: string[] = [];
    vi.mocked(kindOf).mockImplementation((name: string) =>
      kind(String(name).toUpperCase(), async (w) => { opened.push(w.kind); }));

    await restoreWorkbench(
      wb([{ kind: 'a' }, null as unknown as SavedWindow, { kind: 'c' }]), CFG, RCTX,
    );

    expect(opened).toEqual(['a', 'c']);
  });
});

