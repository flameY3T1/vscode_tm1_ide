// Regression tests for the `@odata.bind` paths built by tm1.app.createReference.
//
// A bind value is a RESOURCE PATH (URI reference), not an OData literal: the key
// segments need quote-doubling AND percent-encoding. Quote-doubling alone let a
// name containing `/` split the path segment (`Cubes('A/B')` → two segments).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./__mocks__/vscode');
  const window = actual.window as Record<string, unknown>;
  return {
    ...actual,
    window: {
      ...window,
      showInputBox: vi.fn(),
      showQuickPick: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
  };
});

vi.mock('../tm1Rest/applicationsApi', () => ({
  createReference: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn(),
  createLink: vi.fn(),
  deleteApplication: vi.fn(),
  getDocumentContent: vi.fn(),
  uploadDocument: vi.fn(),
  moveApplication: vi.fn(),
  listApplications: vi.fn(),
}));

import * as vscode from 'vscode';
import { createReference } from '../tm1Rest/applicationsApi';
import { registerApplicationCommands } from '../commands/applicationCommands';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' } as unknown as Tm1Config;

/** Register the commands and hand back the tm1.app.createReference handler. */
function createReferenceHandler(): (node: unknown) => Promise<void> {
  const ctx = { subscriptions: [] as unknown[] } as unknown as vscode.ExtensionContext;
  registerApplicationCommands(ctx, { getConfig: () => CFG, refreshNode: vi.fn(), refresh: vi.fn() });
  const call = vi.mocked(vscode.commands.registerCommand).mock.calls
    .find(c => c[0] === 'tm1.app.createReference');
  if (!call) { throw new Error('tm1.app.createReference not registered'); }
  return call[1] as (node: unknown) => Promise<void>;
}

const NODE = { meta: { serverId: 's1', appPath: [] } };

/** Drive the command: pick `refType`, answer the prompts, accept the default name. */
async function runCreateReference(refType: string, answers: string[]): Promise<{ name: string; bind: string }> {
  const qp = vi.mocked(vscode.window.showQuickPick);
  const ib = vi.mocked(vscode.window.showInputBox);
  qp.mockReset(); ib.mockReset();
  vi.mocked(createReference).mockClear();

  qp.mockResolvedValueOnce(refType as never)    // reference type
    .mockResolvedValueOnce(undefined as never); // pickScope → public
  for (const a of answers) { ib.mockResolvedValueOnce(a as never); }
  // last showInputBox = "Reference name"; echo back the offered default
  ib.mockImplementationOnce(((opts: { value?: string }) => Promise.resolve(opts.value)) as never);

  await createReferenceHandler()(NODE);

  const call = vi.mocked(createReference).mock.calls[0];
  expect(call, 'createReference was not called').toBeDefined();
  return { name: call[1] as string, bind: call[3] as string };
}

describe('tm1.app.createReference — @odata.bind encoding', () => {
  beforeEach(() => vi.mocked(vscode.commands.registerCommand).mockClear());

  it('Cube bind percent-encodes the key', async () => {
    const { bind } = await runCreateReference('Cube', ['Sales']);
    expect(bind).toBe("Cubes('Sales')");
  });

  it('a `/` in a name does NOT split the path segment', async () => {
    const { bind } = await runCreateReference('Cube', ['A/B']);
    expect(bind).toBe("Cubes('A%2FB')");
    // one `Cubes(` segment only — the slash must not create a second one
    expect(bind.split('/').length).toBe(1);
  });

  it('View bind keeps the multi-segment shape and encodes each segment', async () => {
    const { bind } = await runCreateReference('View', ['A/B', 'V W']);
    expect(bind).toBe("Cubes('A%2FB')/Views('V%20W')");
  });

  it('Subset bind encodes all three segments', async () => {
    const { bind } = await runCreateReference('Subset', ['D#1', 'H 1', 'S/1']);
    expect(bind).toBe("Dimensions('D%231')/Hierarchies('H%201')/Subsets('S%2F1')");
  });

  it('single quotes stay doubled (OData literal escape) and are not percent-encoded', async () => {
    const { bind } = await runCreateReference('Process', ["o'brien"]);
    expect(bind).toBe("Processes('o''brien')");
  });

  it('Dimension + Chore binds are encoded', async () => {
    expect((await runCreateReference('Dimension', ['D/1'])).bind).toBe("Dimensions('D%2F1')");
    expect((await runCreateReference('Chore', ['C 1'])).bind).toBe("Chores('C%201')");
  });

  it('control-object names encode `}` exactly once (no %257D double-encode)', async () => {
    const { bind } = await runCreateReference('Cube', ['}StatsByCube']);
    expect(bind).toBe("Cubes('%7DStatsByCube')");
    expect(bind).not.toContain('%257D');
  });

  it('a pre-encoded literal typed by the user is not re-encoded into %257D by us', async () => {
    // `%7DGroups`-style literals appear hardcoded elsewhere; if one is ever typed
    // here it stays a single-encoded `%` → `%25`, never a `%7D` → `%257D` cascade.
    const typed = await runCreateReference('Dimension', ['%7DGroups']);
    expect(typed.bind).toBe("Dimensions('%257DGroups')"); // literal '%' escaped once, as expected
    const real = await runCreateReference('Dimension', ['}Groups']);
    expect(real.bind).toBe("Dimensions('%7DGroups')");
    expect(real.bind).not.toContain('%257D');
  });

  it('the default reference Name is the RAW leaf name, never the encoded bind', async () => {
    const { name } = await runCreateReference('View', ['A/B', "V'x"]);
    expect(name).toBe("V'x");
    expect(name).not.toContain('%');
    expect(name).not.toContain("''");
  });
});
