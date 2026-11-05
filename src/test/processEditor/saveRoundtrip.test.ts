import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Round trip of a process save: what TM1 sends on open must come back
 * unchanged in the PATCH when the user saves without editing anything.
 *
 * `save.ts` has the highest fix ratio of the editor (0.65, hotspot analysis
 * 2026-11-02), and its fixes were one lost field at a time: DataSource and
 * HasSecurityAccess on the compile revert, UIData/VariablesUIData on export
 * and copy, the header on the git mirror. This test checks every writable
 * field at once, so a field added or dropped later fails here too.
 *
 * The fixture is a live answer (a second 11.8 test server, 2026-11-02) to
 * `$select=PROCESS_FULL_SELECT` for a throwaway process with every field set:
 * numeric and string parameter, an ignored source column, an ASCII DataSource,
 * security access on, Architect wizard state in UIData, CRLF line ends.
 */

vi.mock('../../tm1Rest/client', async (orig) => ({
  ...(await orig<typeof import('../../tm1Rest/client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('../../tm1Rest/processCompile', () => ({ compileProcess: vi.fn(async () => []) }));
vi.mock('../../commands/git/mirror', () => ({ mirrorProcessAfterSave: vi.fn() }));

import { handleMonacoSave } from '../../commands/processEditor/save';
import { extractProcessData } from '../../commands/processEditor/processEditorUtils';
import { apiRequest } from '../../tm1Rest/client';
import { _sessions } from '../../commands/processEditor/state';
import { testSession } from '../helpers/processEditorSession';
import type { Tm1Config, DataSource } from '../../tm1Rest/transport/types';

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '../fixtures/processRoundtrip.json'), 'utf8')) as Record<string, unknown>;
const NAME = String(FIXTURE.Name);
const CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', rejectUnauthorized: false, authType: 'Basic' } as Tm1Config;

/** Fields a save writes. `Name` (a rename on 11.x) and `Attributes` are not part of it. */
const WRITTEN = [
  'PrologProcedure', 'MetadataProcedure', 'DataProcedure', 'EpilogProcedure',
  'HasSecurityAccess', 'Parameters', 'Variables', 'VariablesUIData', 'DataSource',
] as const;

let patches: Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  (vscode.window as any).setStatusBarMessage = vi.fn();
  patches = [];
  vi.mocked(apiRequest).mockImplementation(async (method: string, _path: string, body?: string) => {
    if (method === 'PATCH') { patches.push(JSON.parse(String(body))); }
    return { statusCode: 200, body: method === 'GET' ? JSON.stringify(FIXTURE) : '{}' } as never;
  });
  _sessions.clear();
});

/** Opens the fixture the way `openPanel.ts` does and saves it unchanged. */
async function openAndSaveUnchanged(): Promise<Record<string, unknown>> {
  const panel: any = { title: '', webview: { postMessage: vi.fn(), onDidReceiveMessage: vi.fn() } };
  const key = `srv|${NAME}`;
  const opened = extractProcessData(NAME, FIXTURE);
  const session = testSession(panel, key, NAME, 'srv', CONFIG);
  session.code = {
    prolog: opened.prolog, metadata: opened.metadata, data: opened.data, epilog: opened.epilog,
    parameters: opened.parameters, variables: opened.variables, hasSecurity: opened.hasSecurity,
  };
  session.dataSource = opened.dataSource;
  session.dirty = true;

  // The webview hands back what it was given.
  const ok = await handleMonacoSave(
    panel, key, NAME, 'srv',
    { prolog: opened.prolog, metadata: opened.metadata, data: opened.data, epilog: opened.epilog },
    opened.parameters, opened.dataSource as DataSource, opened.variables,
    CONFIG, false, 0, opened.hasSecurity,
  );
  expect(ok).toBe(true);
  expect(patches).toHaveLength(1);
  return patches[0];
}

describe('process save round trip (open, save unchanged)', () => {
  it.each(WRITTEN)('%s comes back as TM1 sent it', async (field) => {
    const body = await openAndSaveUnchanged();
    expect(body[field]).toEqual(FIXTURE[field]);
  });

  it('sends no Name (TM1 11.x reads it as a rename) and leaves UIData alone', async () => {
    const body = await openAndSaveUnchanged();
    expect(body).not.toHaveProperty('Name');
    // PATCH keeps what it does not name; sending it would need it read first.
    expect(body).not.toHaveProperty('UIData');
  });

  it('writes no field beyond the known set', async () => {
    const body = await openAndSaveUnchanged();
    expect(Object.keys(body).sort()).toEqual([...WRITTEN].sort());
  });
});

// The compile check runs after the deploy; on errors the previous version is
// written back. Two of the six field-loss fixes were on this path
// (1a29e587 DataSource, a3ff93b1 HasSecurityAccess).
describe('process save round trip: the compile revert restores what was opened', () => {
  it.each(WRITTEN)('%s', async (field) => {
    const { compileProcess } = await import('../../tm1Rest/processCompile');
    vi.mocked(compileProcess).mockResolvedValueOnce([{ Procedure: 'Prolog', LineNumber: 1, Message: 'syntax' }] as never);
    const panel: any = { title: '', webview: { postMessage: vi.fn(), onDidReceiveMessage: vi.fn() } };
    const key = `srv|${NAME}`;
    const opened = extractProcessData(NAME, FIXTURE);
    const session = testSession(panel, key, NAME, 'srv', CONFIG);
    session.code = {
      prolog: opened.prolog, metadata: opened.metadata, data: opened.data, epilog: opened.epilog,
      parameters: opened.parameters, variables: opened.variables, hasSecurity: opened.hasSecurity,
    };
    session.dataSource = opened.dataSource;
    session.dirty = true;

    // An edit in every part the editor writes, so the revert has to undo each.
    const ok = await handleMonacoSave(
      panel, key, NAME, 'srv',
      { prolog: 'x', metadata: 'x', data: 'x', epilog: 'x' },
      [], { Type: 'None' } as DataSource, [],
      CONFIG, false, 0, !opened.hasSecurity,
    );
    expect(ok).toBe(false);
    expect(patches).toHaveLength(2);
    expect(patches[1][field]).toEqual(FIXTURE[field]);
  });
});
