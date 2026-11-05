/**
 * The process editor stayed permanently empty — toolbar, tabs and
 * status line were there, only no code area, and no message whatsoever.
 *
 * Cause: `openProcess` called `getProcess` WITHOUT `timeoutMs`, so
 * `tm1.timeoutMs` applied with its default **0** = no idle timer. If the socket hangs
 * (half-open keep-alive connection), the promise never settles, the
 * error handling is never reached, and the panel sits empty until
 * it is closed. A time limit turns this into a visible error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../commands/processEditor/debugSession', () => ({ cleanupDebugSession: vi.fn() }));
const getProcess = vi.fn().mockResolvedValue({
  Parameters: [], DataSource: { Type: 'None' }, Variables: [],
  PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
  HasSecurityAccess: false,
});
vi.mock('../../tm1Rest/processApi', () => ({
  PROCESS_FULL_SELECT: 'Name,DataSource,Variables,VariablesUIData,UIData',
  getProcess: (...args: unknown[]) => getProcess(...args),
}));

import { openProcess } from '../../commands/processEditor/openPanel';
import { _sessions, configureProcessEditor } from '../../commands/processEditor/state';
import { clearWindowsForTest } from '../../workbench/windowRegistry';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CONFIG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;

describe('process editor: the load fetch does not run without a time limit', () => {
  beforeEach(() => {
    getProcess.mockClear();
    clearWindowsForTest();
    _sessions.clear();
    configureProcessEditor({ extensionUri: vscode.Uri.file(process.cwd()) });
  });

  it('getProcess is given a finite time limit', async () => {
    expect(await openProcess('MyProcess', undefined, CONFIG)).toBe(true);

    expect(getProcess).toHaveBeenCalledTimes(1);
    const timeoutArg = getProcess.mock.calls[0][3];
    expect(typeof timeoutArg).toBe('number');
    // In `transport/http.ts`, 0 explicitly means "no idle timer" — exactly
    // the state that produced the empty editor.
    expect(timeoutArg).toBeGreaterThan(0);
    expect(Number.isFinite(timeoutArg)).toBe(true);
  });

  it('a hanging fetch ends as an error, not as an empty panel', async () => {
    getProcess.mockRejectedValueOnce(new Error('TM1 request timeout: no response/data for 60s (idle)'));

    expect(await openProcess('MyProcess', undefined, CONFIG)).toBe(false);
    // Panel gone instead of left standing empty.
    expect(_sessions.size).toBe(0);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
