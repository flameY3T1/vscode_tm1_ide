/**
 * Review 2026-10-02 (panel lifecycle): the process editor kept working on a
 * panel the user had closed during an `await`.
 *  - Save, then close before deploy/compile finish: the meta lookup hit
 *    `undefined`, so a successful deploy was reported as "Deploy failed" and
 *    the recovery draft was never cleared.
 *  - Close while the process loads: same lookup, "Failed to load process".
 * Also pins the parameter lookup for Insert Node Ref, which used to be a round
 * trip the webview never answered (2 s wait, always []).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../commands/processEditor/debugSession', () => ({ cleanupDebugSession: vi.fn() }));
vi.mock('../../tm1Rest/processCompile', () => ({ compileProcess: vi.fn().mockResolvedValue([]) }));
vi.mock('../../tm1Client', () => ({ deployProcess: vi.fn().mockResolvedValue(undefined), apiRequest: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));
vi.mock('../../tm1Rest/processApi', () => ({
  PROCESS_FULL_SELECT: 'Name',
  fetchProcessUiData: vi.fn(),
  getProcess: vi.fn().mockResolvedValue({
    Parameters: [{ Name: 'pServer', Type: 'String', Value: '' }], DataSource: { Type: 'None' }, Variables: [],
    PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
    HasSecurityAccess: false,
  }),
}));

import { getProcess } from '../../tm1Rest/processApi';
import { openProcess, getActivePanelParameters } from '../../commands/processEditor/openPanel';
import { handleMonacoSave } from '../../commands/processEditor/save';
import {
  _sessions, configureProcessEditor, panelKey, sessionScope, setLastActivePanel,
} from '../../commands/processEditor/state';
import { clearWindowsForTest } from '../../workbench/windowRegistry';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CONFIG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;
const KEY = panelKey(sessionScope(CONFIG), 'MyProcess');

describe('process editor — closing the tab during an await', () => {
  beforeEach(() => {
    clearWindowsForTest();
    _sessions.clear();
    setLastActivePanel(null);
    configureProcessEditor({ extensionUri: vscode.Uri.file(process.cwd()) });
    vi.mocked(vscode.window.showErrorMessage).mockClear();
  });

  it('a save that finishes after the close is still reported as a success', async () => {
    await openProcess('MyProcess', undefined, CONFIG);
    const panel = _sessions.get(KEY)!.panel;
    _sessions.get(KEY)!.dirty = true;

    const { deployProcess } = await import('../../tm1Client');
    vi.mocked(deployProcess).mockImplementationOnce(async () => { panel.dispose(); });

    const ok = await handleMonacoSave(
      panel, KEY, 'MyProcess', 'http://srv',
      { prolog: 'x', metadata: '', data: '', epilog: '' },
      undefined, { Type: 'None' } as never, undefined, CONFIG, true,
    );
    expect(ok).toBe(true);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('a load that finishes after the close neither errors nor refills the state', async () => {
    let release!: () => void;
    vi.mocked(getProcess).mockImplementationOnce(() => new Promise(r => {
      release = () => r({
        Parameters: [], DataSource: { Type: 'None' }, Variables: [],
        PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
      } as never);
    }));
    const opening = openProcess('MyProcess', undefined, CONFIG);
    await Promise.resolve();
    const closed = _sessions.get(KEY)!;
    closed.panel.dispose();
    release();
    await opening;

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(_sessions.has(KEY)).toBe(false);
    expect(closed.code).toBeUndefined();
  });

  it('Insert Node Ref reads the parameters from host state, without a round trip', async () => {
    await openProcess('MyProcess', undefined, CONFIG);
    setLastActivePanel(_sessions.get(KEY)!.panel);
    expect((await getActivePanelParameters()).map(p => p.Name)).toEqual(['pServer']);

    _sessions.get(KEY)!.draft = { sections: { prolog: '', metadata: '', data: '', epilog: '' },
      parameters: [{ Name: 'pEdited', Type: 'String', Value: '' }], dataSource: null, variables: [] };
    expect((await getActivePanelParameters()).map(p => p.Name)).toEqual(['pEdited']);
  });
});
