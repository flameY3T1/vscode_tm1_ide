/**
 * Host-side guards of the Chore Editor panel (`commands/chore/choreEditor.ts`).
 *
 * Covered here — both are things the webview cannot be trusted with, because a
 * webview can be reloaded and any message can be posted from anywhere:
 *   - MED-4: only ONE save may run per panel. Both save paths run
 *     deactivate → DELETE every task → PATCH the new list, so a second,
 *     overlapping run would clear away what the first had just written.
 *   - MED-3 (second half): a FAILED `getProcessParams` must be reported as a
 *     failure, never as `params: []` — an empty definition is a valid answer and
 *     was cached as one forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { MockWebviewPanel } from '../__mocks__/vscode';

const rest = vi.hoisted(() => ({
  listProcesses: vi.fn(),
  getProcess: vi.fn(),
  getChoreDetail: vi.fn(),
  updateChore: vi.fn(),
  clearChoreTasks: vi.fn(),
  createChore: vi.fn(),
  deleteChore: vi.fn(),
  choreExists: vi.fn(),
  executeChore: vi.fn(),
}));

vi.mock('../../tm1Rest/choreApi', () => ({
  getChoreDetail: rest.getChoreDetail,
  updateChore: rest.updateChore,
  clearChoreTasks: rest.clearChoreTasks,
  createChore: rest.createChore,
  deleteChore: rest.deleteChore,
  choreExists: rest.choreExists,
  executeChore: rest.executeChore,
}));

vi.mock('../../tm1Rest/processApi', () => ({
  listProcesses: rest.listProcesses,
  getProcess: rest.getProcess,
}));

vi.mock('../../commands/chore/choreEditorWebview', () => ({
  getChoreEditorHtml: () => '<html></html>',
}));

vi.mock('../../commands/serverManager', () => ({
  getServerNameByUrl: () => undefined,
  formatServerLabel: () => '',
}));

import { ChoreEditorManager } from '../../commands/chore/choreEditor';

const CFG = { serverUrl: 'http://tm1.test:8000', username: 'u', authType: 'Basic' } as never;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** A chore-detail body as `getChoreDetail` returns it (raw, pre-mapping). */
function choreBody(): Record<string, unknown> {
  return {
    Name: 'Nightly',
    Active: false,
    DSTSensitive: false,
    ExecutionMode: 'SingleCommit',
    StartTime: '2025-01-01T00:00:00Z',
    Frequency: 'P1DT00H00M00S',
    Tasks: [{ Step: 0, Process: { Name: 'Load' }, Parameters: [{ Name: 'pYear', Value: 2025 }] }],
  };
}

/** The `choreData` the webview posts back with a save. */
function choreData(): Record<string, unknown> {
  return {
    Name: 'Nightly',
    Active: false,
    DST: false,
    ExecutionMode: 'SingleCommit',
    StartTime: '2025-01-01T00:00:00Z',
    Frequency: 'P1DT00H00M00S',
    Tasks: [{ Step: 0, processName: 'Load', Parameters: [{ Name: 'pYear', Type: 'Numeric', Value: '2025' }] }],
  };
}

async function openPanel(name = 'Nightly'): Promise<MockWebviewPanel> {
  await ChoreEditorManager.open(name, CFG, () => {});
  const created = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return created[created.length - 1].value as MockWebviewPanel;
}

/** Let queued microtasks/timers run so the async message handler makes progress. */
const settle = (): Promise<unknown> => new Promise((r) => setTimeout(r, 5));

function postedTypes(panel: MockWebviewPanel): string[] {
  return vi.mocked(panel.webview.postMessage).mock.calls.map(c => (c[0] as { type: string }).type);
}

/**
 * `showInputBox` is not part of the shared vscode mock; the "Save as" name
 * prompt needs it, so it is stubbed here (re-installed per test, since
 * `clearAllMocks` wipes it).
 */
const showInputBox = vi.fn<(...args: unknown[]) => Promise<string | undefined>>();
function installInputBoxStub(): void {
  (vscode.window as unknown as { showInputBox: typeof showInputBox }).showInputBox = showInputBox;
  showInputBox.mockReset();
  showInputBox.mockResolvedValue(undefined);
}

describe('ChoreEditorManager — host-side save lock (MED-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installInputBoxStub();
    ChoreEditorManager.disposeAll();
    ChoreEditorManager.initialize(vscode.Uri.file('/ext') as never);
    rest.listProcesses.mockResolvedValue([{ Name: 'Load' }]);
    rest.getProcess.mockResolvedValue({ Name: 'Load', Parameters: [{ Name: 'pYear', Type: 1, Value: 1900 }] });
    rest.getChoreDetail.mockResolvedValue({ data: choreBody(), url: "Chores('Nightly')?$select=…" });
    rest.updateChore.mockResolvedValue(undefined);
    rest.clearChoreTasks.mockResolvedValue(undefined);
    rest.choreExists.mockResolvedValue(false);
  });

  it('runs the second Save only after the first finished — one clear per save', async () => {
    // Hold the very first PATCH (the deactivate) so save #1 is provably still
    // in flight when save #2 arrives.
    const gate = deferred<void>();
    let firstPatch = true;
    rest.updateChore.mockImplementation(async () => {
      if (firstPatch) { firstPatch = false; await gate.promise; }
    });

    const panel = await openPanel();
    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();
    // Save #1 is parked inside its first PATCH: nothing was cleared yet.
    expect(rest.clearChoreTasks).toHaveBeenCalledTimes(0);

    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();

    gate.resolve();
    await settle();
    await settle();

    // The second save was dropped, so the chore's task list was cleared exactly
    // once. Without the lock the second clear would run after the first PATCH
    // had already written the new tasks — and delete them again.
    expect(rest.clearChoreTasks).toHaveBeenCalledTimes(1);
  });

  it('answers the dropped save with saveBusy — not with saveError, which would re-enable the buttons', async () => {
    const gate = deferred<void>();
    let firstPatch = true;
    rest.updateChore.mockImplementation(async () => {
      if (firstPatch) { firstPatch = false; await gate.promise; }
    });

    const panel = await openPanel();
    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();
    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();

    expect(postedTypes(panel)).toContain('saveBusy');
    expect(postedTypes(panel)).not.toContain('saveError');

    gate.resolve();
    await settle();
  });

  it('holds the lock across the "Save as" input box, so a Save behind it is dropped', async () => {
    // The prompt is awaited inside the handler — the panel keeps receiving
    // messages meanwhile, which is exactly how a double-click gets through.
    const prompt = deferred<string | undefined>();
    showInputBox.mockReturnValue(prompt.promise);

    const panel = await openPanel();
    panel.simulateMessage({ type: 'saveAs', originalName: 'Nightly', choreData: choreData() });
    await settle();
    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();

    // The Save never ran: nothing was deactivated or cleared.
    expect(rest.clearChoreTasks).toHaveBeenCalledTimes(0);
    expect(rest.updateChore).toHaveBeenCalledTimes(0);
    expect(postedTypes(panel)).toContain('saveBusy');

    prompt.resolve(undefined);
    await settle();
  });

  it('releases the lock again after a save, so the next one runs', async () => {
    const panel = await openPanel();
    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();
    panel.simulateMessage({ type: 'save', isNew: false, originalName: 'Nightly', choreData: choreData() });
    await settle();
    expect(rest.clearChoreTasks).toHaveBeenCalledTimes(2);
  });

  it('unlocks the webview when the "Save as" prompt is cancelled', async () => {
    // Posting no message at all left the Save buttons disabled forever.
    showInputBox.mockResolvedValue(undefined);
    const panel = await openPanel();
    panel.simulateMessage({ type: 'saveAs', originalName: 'Nightly', choreData: choreData() });
    await settle();
    expect(postedTypes(panel)).toContain('saveCancelled');
  });

  it('unlocks the webview when the "Save as" name is unchanged', async () => {
    showInputBox.mockResolvedValue('Nightly');
    const panel = await openPanel();
    panel.simulateMessage({ type: 'saveAs', originalName: 'Nightly', choreData: choreData() });
    await settle();
    expect(postedTypes(panel)).toContain('saveCancelled');
    expect(rest.choreExists).not.toHaveBeenCalled();
  });
});

describe('ChoreEditorManager — failed parameter fetch (MED-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installInputBoxStub();
    ChoreEditorManager.disposeAll();
    ChoreEditorManager.initialize(vscode.Uri.file('/ext') as never);
    rest.listProcesses.mockResolvedValue([{ Name: 'Load' }]);
    rest.getChoreDetail.mockResolvedValue({ data: choreBody(), url: 'x' });
  });

  function paramsMessage(panel: MockWebviewPanel): { type: string; params?: unknown[]; error?: string } | undefined {
    return vi.mocked(panel.webview.postMessage).mock.calls
      .map(c => c[0] as { type: string; params?: unknown[]; error?: string })
      .find(m => m.type === 'processParams');
  }

  it('reports an error instead of an empty parameter list when getProcess fails', async () => {
    rest.getProcess.mockRejectedValue(new Error('server unreachable'));
    const panel = await openPanel();
    vi.mocked(panel.webview.postMessage).mockClear();

    panel.simulateMessage({ type: 'getProcessParams', processName: 'Load' });
    await settle();

    const msg = paramsMessage(panel);
    expect(msg).toBeDefined();
    // The old shape — `params: []` — is indistinguishable from "this process
    // has no parameters" and was cached as a finished definition forever.
    expect(msg?.params).toBeUndefined();
    expect(msg?.error).toContain('server unreachable');
  });

  it('still reports a genuinely empty parameter list as a successful, empty definition', async () => {
    rest.getProcess.mockResolvedValue({ Name: 'Load', Parameters: [] });
    const panel = await openPanel();
    vi.mocked(panel.webview.postMessage).mockClear();

    panel.simulateMessage({ type: 'getProcessParams', processName: 'Load' });
    await settle();

    const msg = paramsMessage(panel);
    expect(msg?.params).toEqual([]);
    expect(msg?.error).toBeUndefined();
  });
});
