// src/test/bulkDeployWebview.test.ts
//
// Guards of bulk migration on the HOST SIDE.
//
// Until 2026-09-20 there was no test for `BulkDeployPanel` — the delete page
// has 421 test lines for the same spots. Unchecked was exactly what
// decides whether anything is written: the lock logic, the abort on an
// unreadable inventory list, the split into writable/locked, the
// confirmation after flattening, and the reports afterwards.
//
// `onMessage` is private — exactly this path is checked, the way the
// host calls it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// ── Doubles ─────────────────────────────────────────────────────────────────
//
// `tm1Rest/client` is mocked too, although no test needs it directly: without
// the bolt, a path that a future test forgets would run into the real network
// and end in a timeout instead of in a clear error.
const deployOne = vi.hoisted(() => vi.fn());
const readTargetInventory = vi.hoisted(() => vi.fn());
const checkDeployItems = vi.hoisted(() => vi.fn());

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../commands/deploy/deployWrite', () => ({ deployOne }));
vi.mock('../commands/deploy/deployCheck', async () => {
  const pure = await import('../webviews/bulkDeployPure');
  return { readTargetInventory, checkDeployItems, emptyCheck: pure.emptyCheck };
});
vi.mock('../references/referenceIndexService', () => ({
  getOrBuildIndex: vi.fn(async () => ({ incomplete: [] as string[] })),
  invalidateReferenceIndex: vi.fn(),
}));
vi.mock('../providers/fetchNames', () => ({ invalidateCache: vi.fn() }));

const serverConfigs = new Map<string, { serverUrl: string }>();
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../serverState/state', async () => await import('../commands/serverManager'));
vi.mock('../commands/serverManager', () => ({
  getConnectedIds: () => [...serverConfigs.keys()],
  getServerConfig: (id: string) => serverConfigs.get(id),
  getServerNameByUrl: () => undefined,
}));

import { BulkDeployPanel, sameServer, targetOptions } from '../webviews/bulkDeployWebview';
import { emptyCheck } from '../webviews/bulkDeployPure';

const SRC = { serverUrl: 'http://quelle:1234' } as never;

function emptyInventory(over: Record<string, unknown> = {}) {
  return {
    cubes: new Set<string>(), dims: new Set<string>(), hiers: new Set<string>(),
    processes: new Set<string>(), chores: new Set<string>(), rules: new Set<string>(),
    views: new Set<string>(), subsets: new Set<string>(), failed: [] as string[],
    ...over,
  };
}

/** Send a message through the private handler and collect what came back. */
async function send(msg: unknown): Promise<unknown[]> {
  const posted: unknown[] = [];
  const panel = {
    webview: { postMessage: (m: unknown) => { posted.push(m); } },
  } as unknown as vscode.WebviewPanel;
  await (BulkDeployPanel as unknown as {
    onMessage(m: unknown, p: vscode.WebviewPanel, c: unknown, s: string): Promise<void>;
  }).onMessage(msg, panel, SRC, 'srcId');
  return posted;
}

const deployMsg = (items: unknown[], targetId = 'tgtId'): unknown =>
  ({ type: 'deploy', gen: 0, targetId, items });

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` leaves `…Once` queues standing: an answer that a
  // failed test no longer picked up landed in the next one.
  for (const m of [deployOne, readTargetInventory, checkDeployItems, vi.mocked(vscode.window.showWarningMessage)]) {
    m.mockReset();
  }
  serverConfigs.clear();
  serverConfigs.set('srcId', { serverUrl: 'http://quelle:1234' });
  serverConfigs.set('tgtId', { serverUrl: 'http://ziel:1234' });
  readTargetInventory.mockResolvedValue(emptyInventory());
  checkDeployItems.mockImplementation(async (_cfg: unknown, items: Array<Record<string, unknown>>) =>
    items.map(i => ({ ...i, check: emptyCheck() })));
  deployOne.mockResolvedValue('written');
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Deploy' as never);
  BulkDeployPanel.initialize({ fsPath: '/x' } as never, () => { /* no tree */ });
});

// ── Target = source (B5) ──────────────────────────────────────────────────────

describe('sameServer', () => {
  it('recognizes the same instance despite slash and spelling', () => {
    expect(sameServer('http://TM1:1234/', 'http://tm1:1234')).toBe(true);
  });

  it('distinguishes different ports', () => {
    expect(sameServer('http://tm1:1234', 'http://tm1:5678')).toBe(false);
  });

  it('without a URL there is no equality — otherwise "unknown" would count as "equal"', () => {
    expect(sameServer(undefined, 'http://tm1:1234')).toBe(false);
    expect(sameServer('http://tm1:1234', undefined)).toBe(false);
  });
});

describe('target list', () => {
  it('does not allow a SECOND profile on the same instance as a target', () => {
    // Exactly the case from B5: the profile id is different, the server is not.
    serverConfigs.set('srcAlias', { serverUrl: 'http://quelle:1234/' });
    const targets = targetOptions('srcId', 'http://quelle:1234');
    expect(targets.map(t => t.id)).toEqual(['tgtId']);
  });

  it('accepts a real second server', () => {
    expect(targetOptions('srcId', 'http://quelle:1234').map(t => t.id)).toEqual(['tgtId']);
  });
});

describe('second bolt in the job', () => {
  it('rejects a run onto its own instance without writing', () => {
    // The target list is built on open, the job runs later: if a profile
    // on the same instance is added in between, only this catches it.
    serverConfigs.set('tgtId', { serverUrl: 'http://quelle:1234' });
    return send(deployMsg([{ kind: 'process', name: 'Load' }])).then(posted => {
      expect(posted).toContainEqual(
        expect.objectContaining({ type: 'error', message: expect.stringContaining('same server') }));
      expect(deployOne).not.toHaveBeenCalled();
    });
  });
});

// ── Lock logic ──────────────────────────────────────────────────────────────

describe('what locks the write', () => {
  it('does not write what needs something missing over there', async () => {
    checkDeployItems.mockResolvedValue([{
      kind: 'chore', name: 'Nightly',
      check: { ...emptyCheck(), missing: [{ kind: 'process', name: 'Load' }] },
    }]);
    await send(deployMsg([{ kind: 'chore', name: 'Nightly' }]));
    expect(deployOne).not.toHaveBeenCalled();
  });

  it('what goes along in the SAME selection is not missing', async () => {
    // The process is written before the chore — it is over there before the
    // chore needs it.
    checkDeployItems.mockResolvedValue([
      { kind: 'process', name: 'Load', check: emptyCheck() },
      {
        kind: 'chore', name: 'Nightly',
        check: { ...emptyCheck(), missing: [{ kind: 'process', name: 'Load' }] },
      },
    ]);
    await send(deployMsg([
      { kind: 'process', name: 'Load' }, { kind: 'chore', name: 'Nightly' },
    ]));
    expect(deployOne).toHaveBeenCalledTimes(2);
  });

  it('a finding from an UNREADABLE list does not lock', async () => {
    // Nothing is blocked on a guess here: if the target's cube list could not
    // be read at all, "missing over there" is no statement.
    readTargetInventory.mockResolvedValue(emptyInventory({ failed: ['cube'] }));
    checkDeployItems.mockResolvedValue([{
      kind: 'view', name: 'Default', parent: 'Sales',
      check: { ...emptyCheck(), missing: [{ kind: 'cube', name: 'Sales' }] },
    }]);
    await send(deployMsg([{ kind: 'view', name: 'Default', parent: 'Sales' }]));
    expect(deployOne).toHaveBeenCalledTimes(1);
  });

  it('aborts when the target\'s CHORE list could not be read', async () => {
    // Without it, "does it already exist over there?" is a guess — and that decides whether
    // `saveChore` or `saveChoreAs` runs.
    readTargetInventory.mockResolvedValue(emptyInventory({ failed: ['chore'] }));
    const posted = await send(deployMsg([{ kind: 'chore', name: 'Nightly' }]));
    expect(posted).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(deployOne).not.toHaveBeenCalled();
  });
});

// ── existsOnTarget ──────────────────────────────────────────────────────────

describe('chore: existing or new', () => {
  it('reports a chore that exists over there as existing', async () => {
    readTargetInventory.mockResolvedValue(emptyInventory({ chores: new Set(['nightly']) }));
    await send(deployMsg([{ kind: 'chore', name: 'Nightly' }]));
    expect(deployOne.mock.calls[0][3]).toBe(true);
  });

  it('reports an unknown chore as new', async () => {
    await send(deployMsg([{ kind: 'chore', name: 'Nightly' }]));
    expect(deployOne.mock.calls[0][3]).toBe(false);
  });

  it('applies ONLY to chores — a process of the same name does not count', async () => {
    readTargetInventory.mockResolvedValue(emptyInventory({ chores: new Set(['load']) }));
    await send(deployMsg([{ kind: 'process', name: 'Load' }]));
    expect(deployOne.mock.calls[0][3]).toBe(false);
  });
});

// ── Flattening (B6) ─────────────────────────────────────────────────────────

describe('the ONE confirmation after flattening', () => {
  const subset = { kind: 'subset', name: 'Top10', parent: 'Region', hierarchy: 'Region' };

  it('does not ask at all when none of the subsets stands over there', async () => {
    await send(deployMsg([subset]));
    // Only the collective confirmation before the run, no second one.
    expect(vi.mocked(vscode.window.showWarningMessage)).toHaveBeenCalledTimes(1);
    expect(deployOne.mock.calls[0][5]).toBe('all');
  });

  it('asks ONCE when something over there is overwritten', async () => {
    readTargetInventory.mockResolvedValue(
      emptyInventory({ subsets: new Set(['region|region|top10']) }));
    vi.mocked(vscode.window.showWarningMessage)
      .mockResolvedValueOnce('Deploy' as never)
      .mockResolvedValueOnce('Replace' as never);
    await send(deployMsg([subset, { ...subset, name: 'Top20' }]));
    // Two subsets, but only one additional question — before, it was one per item.
    expect(vi.mocked(vscode.window.showWarningMessage)).toHaveBeenCalledTimes(2);
    expect(deployOne.mock.calls[0][5]).toBe('all');
  });

  it('"Skip these" passes `skip` through', async () => {
    readTargetInventory.mockResolvedValue(
      emptyInventory({ subsets: new Set(['region|region|top10']) }));
    vi.mocked(vscode.window.showWarningMessage)
      .mockResolvedValueOnce('Deploy' as never)
      .mockResolvedValueOnce('Skip those' as never);
    await send(deployMsg([subset]));
    expect(deployOne.mock.calls[0][5]).toBe('skip');
  });

  it('a dismissed dialog writes NOTHING', async () => {
    readTargetInventory.mockResolvedValue(
      emptyInventory({ subsets: new Set(['region|region|top10']) }));
    vi.mocked(vscode.window.showWarningMessage)
      .mockResolvedValueOnce('Deploy' as never)
      .mockResolvedValueOnce(undefined as never);
    await send(deployMsg([subset]));
    expect(deployOne).not.toHaveBeenCalled();
  });
});

// ── Reports ────────────────────────────────────────────────────────────────

describe('the report after the run', () => {
  it('reports a clean run as success', async () => {
    await send(deployMsg([{ kind: 'process', name: 'Load' }]));
    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalled();
  });

  it('reports a failure as a warning and keeps going', async () => {
    deployOne.mockRejectedValueOnce(new Error('HTTP 500'));
    await send(deployMsg([
      { kind: 'process', name: 'A' }, { kind: 'process', name: 'B' },
    ]));
    // No bailout: the second item is still attempted.
    expect(deployOne).toHaveBeenCalledTimes(2);
    const warnings = vi.mocked(vscode.window.showWarningMessage).mock.calls
      .map(c => String(c[0]));
    expect(warnings.some(w => w.includes('failed'))).toBe(true);
  });

  it('a warning from the write path does not get lost in the success message', async () => {
    deployOne.mockResolvedValue({ warn: 'Chore "N" was created, but not activated: x' });
    await send(deployMsg([{ kind: 'chore', name: 'N' }]));
    const warnings = vi.mocked(vscode.window.showWarningMessage).mock.calls
      .map(c => String(c[0]));
    expect(warnings.some(w => w.includes('with warnings'))).toBe(true);
    expect(vi.mocked(vscode.window.showInformationMessage)).not.toHaveBeenCalled();
  });

  it('writes nothing when the confirmation before the run is declined', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as never);
    await send(deployMsg([{ kind: 'process', name: 'Load' }]));
    expect(deployOne).not.toHaveBeenCalled();
  });
});

// ── Target inventory during the run (follow-up review 09-23 F3) ────────────────────

describe('target inventory during the run', () => {
  const subset = { kind: 'subset', name: 'Top10', parent: 'Region', hierarchy: 'Region' };
  const view = { kind: 'view', name: 'ByRegion', parent: 'Sales' };
  const KEY = 'region|region|top10';

  it('enters a just-created subset before the view refers to it', async () => {
    readTargetInventory.mockResolvedValue(emptyInventory({ cubes: new Set(['sales']) }));
    const seen: boolean[] = [];
    deployOne.mockImplementation(async (item: { kind: string }, _s: unknown, _t: unknown, _e: unknown,
      known: { subsets?: Set<string> }) => {
      if (item.kind === 'view') { seen.push(known.subsets?.has(KEY) ?? false); }
      return 'written';
    });
    await send(deployMsg([view, subset]));
    expect(seen).toEqual([true]);
  });

  it('does not enter a rejected subset', async () => {
    readTargetInventory.mockResolvedValue(emptyInventory({ cubes: new Set(['sales']) }));
    const seen: boolean[] = [];
    deployOne.mockImplementation(async (item: { kind: string }, _s: unknown, _t: unknown, _e: unknown,
      known: { subsets?: Set<string> }) => {
      if (item.kind === 'view') { seen.push(known.subsets?.has(KEY) ?? false); return 'written'; }
      return 'cancelled';
    });
    await send(deployMsg([view, subset]));
    expect(seen).toEqual([false]);
  });

  it('passes an unreadable subset list on as unknown, not as empty', async () => {
    readTargetInventory.mockResolvedValue(emptyInventory({ cubes: new Set(['sales']), failed: ['subset'] }));
    await send(deployMsg([view]));
    expect(deployOne.mock.calls[0][4].subsets).toBeUndefined();
  });
});
