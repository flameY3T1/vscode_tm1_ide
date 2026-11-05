// Run loop of the notebook controller: server choice, Stop, sandbox guard for TI.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PARAMS_CELL_LANGUAGE, TI_CELL_LANGUAGE } from '../../notebook/notebookPure';

type Handler = (cells: unknown[], nb: unknown) => Promise<void>;
const h = vi.hoisted(() => ({
  handler: undefined as undefined | ((cells: unknown[], nb: unknown) => Promise<void>),
  cancelOnOutput: false,
  started: [] as unknown[],
  commands: new Map<string, (...a: unknown[]) => unknown>(),
  activeNotebook: undefined as unknown,
  written: '' as string,
}));

vi.mock('vscode', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../__mocks__/vscode');
  const disposable = { dispose: () => undefined };
  class NotebookCellOutput { constructor(public items: unknown[], public metadata?: Record<string, unknown>) {} }
  const item = (value: unknown) => ({ value });
  return {
    ...actual,
    NotebookCellOutput,
    NotebookCellOutputItem: { text: item, stderr: item, error: item },
    NotebookCellKind: { Markup: 1, Code: 2 },
    notebooks: {
      createNotebookController: () => {
        const controller = {
          dispose: () => undefined,
          set executeHandler(fn: Handler) { h.handler = fn; },
          createNotebookCellExecution: (cell: unknown) => {
            const token = { isCancellationRequested: false, onCancellationRequested: () => disposable };
            return {
              token,
              start: () => { h.started.push(cell); },
              end: () => undefined,
              clearOutput: async () => undefined,
              // Stands in for the user pressing Stop while the cell runs.
              replaceOutput: async () => { if (h.cancelOnOutput) { token.isCancellationRequested = true; } },
            };
          },
        };
        return controller;
      },
    },
    commands: {
      ...(actual.commands as object),
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { h.commands.set(id, fn); return disposable; },
    },
    window: {
      ...(actual.window as object),
      get activeNotebookEditor() { return h.activeNotebook ? { notebook: h.activeNotebook } : undefined; },
      showSaveDialog: async () => ({ path: '/r.md' }),
      showTextDocument: async () => undefined,
    },
    workspace: {
      ...(actual.workspace as object),
      fs: { writeFile: async (_u: unknown, b: Uint8Array) => { h.written = new TextDecoder().decode(b); } },
      registerNotebookSerializer: () => disposable,
      onDidCloseNotebookDocument: () => disposable,
    },
    languages: {
      ...(actual.languages as object),
      registerCompletionItemProvider: () => disposable,
      registerDocumentFormattingEditProvider: () => disposable,
    },
  };
});

const connected = new Set<string>();
vi.mock('../../serverState/requireServerConfig', () => ({ serverIdForCommand: vi.fn() }));
vi.mock('../../serverState/state', () => ({
  getServerConfig: (id: string) => (connected.has(id) ? { serverUrl: `http://${id}` } : undefined),
  getServerNameByUrl: () => undefined,
}));
vi.mock('../../tm1Rest/sandboxTracker', () => ({
  withSandbox: () => undefined,
  getActiveSandboxName: vi.fn(),
}));
vi.mock('../../runState/runCancellableProcess', () => ({ runCancellableProcess: vi.fn() }));

import { registerTm1Notebook } from '../../notebook/tm1Notebook';
import { serverIdForCommand } from '../../serverState/requireServerConfig';
import { getActiveSandboxName } from '../../tm1Rest/sandboxTracker';
import { runCancellableProcess } from '../../runState/runCancellableProcess';

function cell(languageId: string, text: string, index: number) {
  const c = {
    index, kind: 2, outputs: [] as unknown[], executionSummary: undefined as undefined | { success: boolean },
    text, document: { languageId, getText: () => c.text }, notebook: undefined as unknown,
  };
  return c;
}

function notebook(uri: string, cells: ReturnType<typeof cell>[]) {
  const nb = { uri: { toString: () => uri, path: uri }, getCells: () => cells };
  for (const c of cells) { c.notebook = nb; }
  return nb;
}

beforeEach(() => {
  h.handler = undefined;
  h.cancelOnOutput = false;
  h.started = [];
  h.commands.clear();
  h.activeNotebook = undefined;
  h.written = '';
  connected.clear();
  vi.mocked(serverIdForCommand).mockReset();
  vi.mocked(getActiveSandboxName).mockReset();
  vi.mocked(runCancellableProcess).mockReset();
  registerTm1Notebook({ subscriptions: [] } as never);
});

describe('tm1 notebook run', () => {
  it('asks instead of switching silently when the chosen server is gone', async () => {
    connected.add('dev');
    vi.mocked(serverIdForCommand).mockResolvedValueOnce('dev');
    const nb = notebook('file:///a.tm1nb', [cell(PARAMS_CELL_LANGUAGE, 'Year = 2026', 0)]);
    await h.handler!(nb.getCells(), nb);
    expect(vi.mocked(serverIdForCommand).mock.calls[0][1]).toEqual({});

    connected.delete('dev');
    connected.add('prod');
    vi.mocked(serverIdForCommand).mockResolvedValueOnce(undefined);
    await h.handler!(nb.getCells(), nb);
    expect(vi.mocked(serverIdForCommand).mock.calls[1][1]).toMatchObject({ alwaysAsk: true });
    expect(h.started).toHaveLength(1);
  });

  it('Stop ends the run: no further cell starts', async () => {
    connected.add('dev');
    vi.mocked(serverIdForCommand).mockResolvedValue('dev');
    h.cancelOnOutput = true;
    const cells = [cell(PARAMS_CELL_LANGUAGE, 'A = 1', 0), cell(PARAMS_CELL_LANGUAGE, 'B = 2', 1)];
    const nb = notebook('file:///b.tm1nb', cells);
    await h.handler!(cells, nb);
    expect(h.started).toEqual([cells[0]]);
  });

  it('refuses a TI cell while a sandbox is active', async () => {
    connected.add('dev');
    vi.mocked(serverIdForCommand).mockResolvedValue('dev');
    vi.mocked(getActiveSandboxName).mockReturnValue('What-if');
    const nb = notebook('file:///c.tm1nb', [cell(TI_CELL_LANGUAGE, 'SaveDataAll;', 0)]);
    await h.handler!(nb.getCells(), nb);
    expect(runCancellableProcess).not.toHaveBeenCalled();
  });

  it('hands the cell token to the cancellable run, so Stop reaches the server thread', async () => {
    connected.add('dev');
    vi.mocked(serverIdForCommand).mockResolvedValue('dev');
    vi.mocked(runCancellableProcess).mockResolvedValue({ result: { ok: true, status: '' }, cancelled: false } as never);
    const nb = notebook('file:///t.tm1nb', [cell(TI_CELL_LANGUAGE, 'SaveDataAll;', 0)]);
    await h.handler!(nb.getCells(), nb);
    const opts = vi.mocked(runCancellableProcess).mock.calls[0][4] as { token?: { onCancellationRequested: unknown } };
    expect(opts.token?.onCancellationRequested).toBeTypeOf('function');
  });

  it('Escape in Select Server keeps the binding, so a later run still asks when it is gone', async () => {
    connected.add('dev');
    connected.add('prod');
    vi.mocked(serverIdForCommand).mockResolvedValueOnce('dev');
    const nb = notebook('file:///d.tm1nb', [cell(PARAMS_CELL_LANGUAGE, 'A = 1', 0)]);
    await h.handler!(nb.getCells(), nb);
    h.activeNotebook = nb;
    vi.mocked(serverIdForCommand).mockResolvedValueOnce(undefined); // Escape
    await h.commands.get('tm1.notebook.selectServer')!();
    connected.delete('dev');
    vi.mocked(serverIdForCommand).mockResolvedValueOnce(undefined); // Escape again
    await h.handler!(nb.getCells(), nb);
    expect(vi.mocked(serverIdForCommand).mock.calls[2][1]).toMatchObject({ alwaysAsk: true });
    expect(h.started).toHaveLength(1);
  });

  it('the report does not count a pass from other parameters or another sandbox than its header', async () => {
    connected.add('dev');
    vi.mocked(serverIdForCommand).mockResolvedValue('dev');
    // The TI cell is refused under a sandbox, so it runs without a server call.
    vi.mocked(getActiveSandboxName).mockReturnValue('What-if');
    const params = cell(PARAMS_CELL_LANGUAGE, 'Year = 2025', 0);
    const ti = cell(TI_CELL_LANGUAGE, 'SaveDataAll;', 1);
    const nb = notebook('file:///e.tm1nb', [params, ti]);
    await h.handler!(nb.getCells(), nb);
    ti.executionSummary = { success: true };
    h.activeNotebook = nb;
    await h.commands.get('tm1.notebook.exportReport')!();
    expect(h.written).toMatch(/1 passed/);

    params.text = 'Year = 2026';
    await h.commands.get('tm1.notebook.exportReport')!();
    expect(h.written).toMatch(/Year = 2026/);
    expect(h.written).toMatch(/0 passed, 0 failed, 1 not run/);

    params.text = 'Year = 2025';
    vi.mocked(getActiveSandboxName).mockReturnValue(undefined);
    await h.commands.get('tm1.notebook.exportReport')!();
    expect(h.written).toMatch(/0 passed, 0 failed, 1 not run/);
  });
});
