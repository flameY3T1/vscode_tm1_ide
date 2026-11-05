/**
 * Two profiles may share a serverUrl (another user, another v12 database).
 * The process editor keyed its sessions by `serverUrl|process`, so opening a
 * process as profile B revealed A's panel, and save, run and debug from that
 * panel went out with A's config (readiness review 2026-11-03, F4).
 * Callers that only know URL + name (deleting the process, the file-mode
 * conflict check) must still find the panels of both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../commands/processEditor/debugSession', () => ({ cleanupDebugSession: vi.fn() }));
vi.mock('../../tm1Rest/processApi', () => ({
  PROCESS_FULL_SELECT: 'Name,DataSource,Variables,VariablesUIData,UIData',
  getProcess: vi.fn().mockResolvedValue({
    Parameters: [], DataSource: { Type: 'None' }, Variables: [],
    PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
    HasSecurityAccess: false,
  }),
}));

import { openProcess } from '../../commands/processEditor/openPanel';
import { disposePanel } from '../../commands/processEditor/lifecycle';
import { _sessions, configureProcessEditor } from '../../commands/processEditor/state';
import { clearWindowsForTest } from '../../workbench/windowRegistry';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const A = { serverUrl: 'http://srv', username: 'alice', password: '', authType: 'Basic' } as unknown as Tm1Config;
const B = { serverUrl: 'http://srv', username: 'bob', password: '', authType: 'Basic' } as unknown as Tm1Config;

describe('process editor: two identities on the same URL', () => {
  beforeEach(() => {
    clearWindowsForTest();
    _sessions.clear();
    configureProcessEditor({ extensionUri: vscode.Uri.file(process.cwd()) });
  });

  it('opens one session per identity, each holding its own config', async () => {
    await openProcess('MyProcess', undefined, A);
    await openProcess('MyProcess', undefined, B);
    const users = [..._sessions.values()].map(s => s.config.username).sort();
    expect(users).toEqual(['alice', 'bob']);
  });

  it('deleting the process closes the panels of both identities', async () => {
    await openProcess('MyProcess', undefined, A);
    await openProcess('MyProcess', undefined, B);
    disposePanel('MyProcess', 'http://srv');
    expect(_sessions.size).toBe(0);
  });
});
