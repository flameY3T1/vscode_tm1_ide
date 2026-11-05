/**
 * The flow behind "Save Workbench" and "Edit Workbench".
 *
 * Counterpart to `restoreFlow.test.ts` — the same construction: the window itself
 * is mocked; what is checked is the ORDER and the content of the decisions
 * in between. What can go wrong here and is therefore pinned down:
 *
 *  • A picker window left open closes over the candidate list from back
 *    then. `WebviewPanelHost.open()` only REVEALS an existing panel,
 *    it does not re-render it — without disposing of the previous one, you
 *    would silently save the state from earlier.
 *  • Save and Edit need SEPARATE key spaces, otherwise
 *    one takes over the other's panel.
 *  • When editing, the workbench's own name is not a name conflict with
 *    itself, and it keeps its `id` — otherwise the tree node jumps.
 *  • The cap `MAX_WINDOWS` and the empty selection must NOT save.
 *
 * `saveFlow` holds its `host` module-global. So that no test inherits from the
 * initialization of an earlier one — under `--sequence.shuffle` exactly the
 * time bomb that `cubeViewerActionsSenders.test.ts` caught — EVERY
 * test calls `initializeWorkbenchPicker()` itself; that creates a new host,
 * and `beforeEach` empties the observation list. Only the test for the MISSING
 * initialization needs an untouched module and gets it via
 * `vi.resetModules()`. The rest imports statically — a `resetModules` before
 * every test would also reload the mocked `vscode`, and the spies in
 * `saveFlow` would then be different objects from the ones checked here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { CandidateWindow } from '../../commands/workbench/collectWindows';
import type { Workbench } from '../../commands/workbench/workbenchStore';
import { MAX_WINDOWS } from '../../commands/workbench/workbenchStorePure';

/**
 * Survives `vi.resetModules()` because it lives in the test file scope and not in
 * the module graph — the mock factories write into it on every fresh
 * import.
 */
const spy = vi.hoisted(() => ({
  hosts: [] as Array<{
    key: string; label: string;
    opened: Array<{ key: string; title: string; onMessage: (m: unknown, p: unknown) => unknown }>;
    panels: Map<string, { dispose: () => void; disposed: boolean }>;
  }>,
}));

vi.mock('../../webviews/webviewPanelHost', () => ({
  WebviewPanelHost: class {
    opened: Array<{ key: string; title: string; onMessage: (m: unknown, p: unknown) => unknown }> = [];
    panels = new Map<string, { dispose: () => void; disposed: boolean }>();
    constructor(public key: string, public label: string) { spy.hosts.push(this as never); }
    initialize(): void { /* Panel creation is not the subject here */ }
    get(k: string) { return this.panels.get(k); }
    open(args: { key: string; title: string; html: unknown; onMessage: (m: unknown, p: unknown) => unknown }) {
      this.opened.push({ key: args.key, title: args.title, onMessage: args.onMessage });
      const panel = { disposed: false, dispose(): void { this.disposed = true; } };
      this.panels.set(args.key, panel);
      return panel;
    }
  },
}));

vi.mock('../../commands/workbench/collectWindows', async () => {
  const echt = await vi.importActual<typeof import('../../commands/workbench/collectWindows')>(
    '../../commands/workbench/collectWindows',
  );
  return { ...echt, collectCandidates: vi.fn() };
});

import { collectCandidates } from '../../commands/workbench/collectWindows';
import { initializeWorkbenchPicker, openWorkbenchPicker } from '../../commands/workbench/saveFlow';

const collect = vi.mocked(collectCandidates);

/** A freshly initialized picker window — one host of its own per test. */
function frisch(): void {
  initializeWorkbenchPicker({} as never);
}

function kandidat(id: string, label = id): CandidateWindow {
  return {
    id, kind: 'tm1CubeViewer', group: 'Cube Viewer', label,
    saved: { kind: 'tm1CubeViewer', target: label },
    checked: true, open: true,
  };
}

/** A store with an observable `save`. */
function ablage(bestand: Workbench[] = []) {
  return {
    list: vi.fn((serverId: string) => bestand.filter(w => w.serverId === serverId)),
    // The parameter is needed so that `save.mock.calls[0][0]` has a type.
    save: vi.fn(async (_w: Workbench) => { /* nothing */ }),
  };
}
type Ablage = ReturnType<typeof ablage>;

/** Pass the picker window's message to the most recently opened panel. */
async function antworte(msg: unknown): Promise<{ disposed: boolean }> {
  const host = spy.hosts.at(-1)!;
  const auf = host.opened.at(-1)!;
  const panel = host.panels.get(auf.key)!;
  await auf.onMessage(msg, panel);
  return panel;
}

beforeEach(() => {
  spy.hosts.length = 0;
  collect.mockReset();
  vi.mocked(vscode.window.showInformationMessage).mockClear();
  vi.mocked(vscode.window.showWarningMessage).mockReset().mockResolvedValue(undefined as never);
});

// ── Open ───────────────────────────────────────────────────────────────────

describe('openWorkbenchPicker: open', () => {
  it('requires initialization instead of silently doing nothing', async () => {
    // Needs an untouched module: `host` is module-global and already set in every
    // other test of this file.
    vi.resetModules();
    const unberuehrt = await import('../../commands/workbench/saveFlow');
    await expect(unberuehrt.openWorkbenchPicker('srv', 'Test', ablage() as never))
      .rejects.toThrow(/initializeWorkbenchPicker/);
  });

  it('reports "no open windows" instead of showing an empty window', async () => {
    frisch();
    collect.mockResolvedValue([]);

    await openWorkbenchPicker('srv', 'Test', ablage() as never);

    expect(spy.hosts[0].opened).toHaveLength(0);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('disposes of a leftover picker window before rendering again', async () => {
    // `host.open()` only REVEALS an existing panel — without disposing,
    // the second opening would show (and save) the list from the first.
    frisch();
    collect.mockResolvedValue([kandidat('c0', 'Umsatz')]);

    await openWorkbenchPicker('srv', 'Test', ablage() as never);
    const erstes = spy.hosts[0].panels.get('srv')!;
    await openWorkbenchPicker('srv', 'Test', ablage() as never);

    expect(erstes.disposed).toBe(true);
    expect(spy.hosts[0].opened).toHaveLength(2);
  });

  it('keeps Save and Edit in separate key spaces', async () => {
    frisch();
    collect.mockResolvedValue([kandidat('c0', 'Umsatz')]);
    const store = ablage([{ id: 'wb-7', serverId: 'srv', name: 'Quartal', savedAt: 1, windows: [] }]);

    await openWorkbenchPicker('srv', 'Test', store as never);
    await openWorkbenchPicker('srv', 'Test', store as never, undefined, { id: 'wb-7', name: 'Quartal' });

    expect(spy.hosts[0].opened.map(o => o.key)).toEqual(['srv', 'srv::edit#wb-7']);
    // And the Save window was NOT disposed in the process.
    expect(spy.hosts[0].panels.get('srv')!.disposed).toBe(false);
  });

  it('passes the saved inventory through to collecting when editing', async () => {
    // Only this way can the window show the UNION — saved entries
    // checked, including the closed ones.
    frisch();
    collect.mockResolvedValue([kandidat('c0', 'Umsatz')]);
    const bestand = [{ kind: 'tm1CubeViewer', target: 'Alt' }];
    const store = ablage([{ id: 'wb-7', serverId: 'srv', name: 'Quartal', savedAt: 1, windows: bestand }]);

    await openWorkbenchPicker('srv', 'Test', store as never, 'http://s', { id: 'wb-7', name: 'Quartal' });

    expect(collect).toHaveBeenCalledWith('srv', 'http://s', bestand);
  });

  it('collects WITHOUT an inventory when saving — there is none', async () => {
    frisch();
    collect.mockResolvedValue([kandidat('c0')]);
    await openWorkbenchPicker('srv', 'Test', ablage() as never, 'http://s');
    expect(collect).toHaveBeenCalledWith('srv', 'http://s', undefined);
  });
});

// ── Save ───────────────────────────────────────────────────────────────────

describe('openWorkbenchPicker: save', () => {
  async function offen(store: Ablage, cands = [kandidat('c0', 'Umsatz'), kandidat('c1', 'Absatz')]) {
    frisch();
    collect.mockResolvedValue(cands);
    await openWorkbenchPicker('srv', 'Test', store as never);
  }

  it('stores the checked windows in list order and closes the window', async () => {
    const store = ablage();
    await offen(store);

    const panel = await antworte({ type: 'save', name: 'Quartal', ids: ['c1', 'c0'] });

    expect(store.save).toHaveBeenCalledTimes(1);
    const gespeichert = store.save.mock.calls[0][0];
    expect(gespeichert.serverId).toBe('srv');
    expect(gespeichert.name).toBe('Quartal');
    // The order comes from the LIST, not from the selection.
    expect(gespeichert.windows.map(w => w.target)).toEqual(['Umsatz', 'Absatz']);
    expect(panel.disposed).toBe(true);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('saves nothing on an empty selection and leaves the window open', async () => {
    const store = ablage();
    await offen(store);
    const panel = await antworte({ type: 'save', name: 'Quartal', ids: [] });
    expect(store.save).not.toHaveBeenCalled();
    expect(panel.disposed).toBe(false);
  });

  it('saves nothing above MAX_WINDOWS', async () => {
    const viele = Array.from({ length: MAX_WINDOWS + 1 }, (_, i) => kandidat(`c${i}`, `W${i}`));
    const store = ablage();
    await offen(store, viele);
    await antworte({ type: 'save', name: 'Zuviel', ids: viele.map(c => c.id) });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('closes the window on cancel without saving', async () => {
    const store = ablage();
    await offen(store);
    const panel = await antworte({ type: 'cancel' });
    expect(store.save).not.toHaveBeenCalled();
    expect(panel.disposed).toBe(true);
  });

  it('assigns a substitute name instead of a nameless workbench', async () => {
    const store = ablage();
    await offen(store);
    await antworte({ type: 'save', name: '', ids: ['c0'] });
    expect((store.save.mock.calls[0][0]).name).toBeTruthy();
  });
});

// ── Name conflict ──────────────────────────────────────────────────────────

describe('openWorkbenchPicker: same name', () => {
  const VORHANDEN: Workbench = { id: 'wb-alt', serverId: 'srv', name: 'Quartal', savedAt: 1, windows: [] };

  async function offen(store: Ablage) {
    frisch();
    collect.mockResolvedValue([kandidat('c0', 'Umsatz')]);
    await openWorkbenchPicker('srv', 'Test', store as never);
  }

  it('asks and overwrites UNDER THE SAME id', async () => {
    // The `id` has to stay, otherwise the tree node jumps and there are two
    // entries with the same name.
    const store = ablage([VORHANDEN]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Overwrite' as never);
    await offen(store);

    await antworte({ type: 'save', name: 'Quartal', ids: ['c0'] });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    const gespeichert = store.save.mock.calls[0][0];
    expect(gespeichert.id).toBe('wb-alt');
    expect(gespeichert.windows.map(w => w.target)).toEqual(['Umsatz']);
  });

  it('does NOT save when the confirmation is declined — and leaves the window open', async () => {
    const store = ablage([VORHANDEN]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as never);
    await offen(store);

    const panel = await antworte({ type: 'save', name: 'Quartal', ids: ['c0'] });

    expect(store.save).not.toHaveBeenCalled();
    expect(panel.disposed).toBe(false);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('does not ask when the name is on a DIFFERENT server', async () => {
    const store = ablage([{ ...VORHANDEN, serverId: 'anderer' }]);
    await offen(store);
    await antworte({ type: 'save', name: 'Quartal', ids: ['c0'] });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});

// ── Edit ───────────────────────────────────────────────────────────────────

describe('openWorkbenchPicker: edit', () => {
  const EIGEN: Workbench = {
    id: 'wb-7', serverId: 'srv', name: 'Quartal', savedAt: 1,
    windows: [{ kind: 'tm1CubeViewer', target: 'Alt' }],
  };

  async function offen(store: Ablage, name = 'Quartal') {
    frisch();
    collect.mockResolvedValue([kandidat('c0', 'Umsatz')]);
    await openWorkbenchPicker('srv', 'Test', store as never, undefined, { id: 'wb-7', name });
  }

  it('writes under the same id and does NOT ask — it is no conflict with itself', async () => {
    const store = ablage([EIGEN]);
    await offen(store);

    const panel = await antworte({ type: 'save', name: 'Quartal', ids: ['c0'] });

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledTimes(1);
    const gespeichert = store.save.mock.calls[0][0];
    expect(gespeichert.id).toBe('wb-7');
    // The window list is REPLACED, not extended: unchecking is the way
    // to get rid of a window.
    expect(gespeichert.windows.map(w => w.target)).toEqual(['Umsatz']);
    expect(panel.disposed).toBe(true);
  });

  it('also renames when editing, without changing the id', async () => {
    const store = ablage([EIGEN]);
    await offen(store);
    await antworte({ type: 'save', name: 'Jahr', ids: ['c0'] });
    const gespeichert = store.save.mock.calls[0][0];
    expect(gespeichert).toMatchObject({ id: 'wb-7', name: 'Jahr' });
  });

  it('does ask when renaming if a FOREIGN workbench has that name', async () => {
    const fremd: Workbench = { id: 'wb-9', serverId: 'srv', name: 'Jahr', savedAt: 2, windows: [] };
    const store = ablage([EIGEN, fremd]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Overwrite' as never);
    await offen(store);

    await antworte({ type: 'save', name: 'Jahr', ids: ['c0'] });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    // What gets overwritten then is the FOREIGN one — that is the conflict that
    // was agreed to.
    expect((store.save.mock.calls[0][0]).id).toBe('wb-9');
  });

  it('keeps the previous name when the window does not send one', async () => {
    const store = ablage([EIGEN]);
    await offen(store);
    await antworte({ type: 'save', name: '', ids: ['c0'] });
    expect((store.save.mock.calls[0][0]).name).toBe('Quartal');
  });

  it('falls back to the create path when the edited workbench is gone in the meantime', async () => {
    // Deleted between opening and saving: there is no `self` any more, so
    // a new entry is created instead of silently doing nothing.
    const store = ablage([]);
    await offen(store);
    await antworte({ type: 'save', name: 'Quartal', ids: ['c0'] });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect((store.save.mock.calls[0][0]).id).not.toBe('wb-7');
  });
});
