/**
 * Regression test for Finding 2 (Task 3 review): `disposeAll()` used to leave
 * process-editor panels in the workbench registry, because unregistration ran
 * inside `onPanelDisposed` (lifecycle.ts), reached only via a dynamic import
 * from the panel's `onDidDispose` handler — at least one microtask after
 * `disposeAll()` had already synchronously cleared `_panels`. `unregisterWindow`
 * now runs synchronously in `openPanel.ts`'s own `onDidDispose`, so it no
 * longer depends on `_panels` still holding the entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../commands/processEditor/debugSession', () => ({ cleanupDebugSession: vi.fn() }));
vi.mock('../../tm1Rest/processApi', () => ({
  // The double must carry the module's whole surface: openPanel imports the
  // select list too, and a missing named export throws on import.
  PROCESS_FULL_SELECT: 'Name,DataSource,Variables,VariablesUIData,UIData',
  getProcess: vi.fn().mockResolvedValue({
    Parameters: [], DataSource: { Type: 'None' }, Variables: [],
    PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
    HasSecurityAccess: false,
  }),
}));

import { openProcess } from '../../commands/processEditor/openPanel';
import { disposeAll } from '../../commands/processEditor/lifecycle';
import { _sessions, configureProcessEditor } from '../../commands/processEditor/state';
import { listWindows, clearWindowsForTest } from '../../workbench/windowRegistry';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CONFIG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;

describe('process editor: disposeAll unregisters from the workbench directory', () => {
  beforeEach(() => {
    clearWindowsForTest();
    _sessions.clear();
    configureProcessEditor({ extensionUri: vscode.Uri.file(process.cwd()) });
  });

  it('leaves the registry empty after "close all"', async () => {
    const opened = await openProcess('MyProcess', undefined, CONFIG);
    expect(opened).toBe(true);
    expect(listWindows()).toHaveLength(1);
    expect(listWindows()[0].kind).toBe('tm1ProcessEditor');

    const cancelled = await disposeAll();

    expect(cancelled).toBe(true); // not cancelled — nothing was dirty
    expect(listWindows()).toHaveLength(0);
  });
});
