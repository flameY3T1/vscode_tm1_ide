/**
 * "Webview is disposed" ×3 on disconnect, reported 2026-08-30 with an open
 * process editor.
 *
 * Sequence: `onDisconnected.fire()` closes the panels, then
 * `onServerChanged` fires SYNCHRONOUSLY right after, and its subscribers iterate over
 * `_panels` — `getActivePanel()` reads `p.active`, `broadcastV12Mode()` and
 * `broadcastSnippets()` post. All three throw on a closed panel.
 * Three accesses, three errors.
 *
 * The cause is not the broadcast, but the fact that `_panels` still lists the closed
 * panel: on close, `openPanel.ts` cleared `unregisterWindow`
 * and `_panelMeta` synchronously, but the `_panels` entry only via
 * `void import('./lifecycle').then(…)` — one microtask later, and
 * `onPanelDisposed` may first still wait for `saveDraft` before that.
 *
 * It is the same bug as in `processEditorDisposeAllUnregisters` (Finding 2):
 * there the window-registry unregistration was moved to the front, the
 * `_panels` entry was left behind. Fixing it individually a second time means
 * forgetting it again the third time — so this test covers all three accesses,
 * not just the one that was reported.
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
import { broadcastSnippets, broadcastV12Mode, disposePanelsForServer } from '../../commands/processEditor/lifecycle';
import { _sessions, configureProcessEditor, getActivePanel } from '../../commands/processEditor/state';
import { clearWindowsForTest } from '../../workbench/windowRegistry';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CONFIG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;

describe('process editor: after disconnecting, _sessions no longer holds a dead panel', () => {
  beforeEach(() => {
    clearWindowsForTest();
    _sessions.clear();
    configureProcessEditor({ extensionUri: vscode.Uri.file(process.cwd()) });
  });

  it('the entry is gone IMMEDIATELY, not only one microtask later', async () => {
    expect(await openProcess('MyProcess', undefined, CONFIG)).toBe(true);
    expect(_sessions.size).toBe(1);

    disposePanelsForServer('http://srv');

    // No `await` in between: this is exactly how `onServerChanged` calls its
    // subscribers right afterwards, and this is exactly where the bug was.
    expect(_sessions.size).toBe(0);
  });

  it('the three accesses from onServerChanged no longer throw', async () => {
    await openProcess('MyProcess', undefined, CONFIG);
    const panel = [..._sessions.values()][0].panel;

    // The stub from `__mocks__/vscode` does not throw on its own. The real
    // VS Code does (`ExtHostWebview` checks for not-disposed), so it is
    // reproduced here — otherwise the test would check a courtesy of the
    // stub instead of the behavior.
    const orig = panel.dispose.bind(panel);
    (panel as unknown as { dispose: () => void }).dispose = () => {
      orig();
      const werfen = (): never => { throw new Error('Webview is disposed'); };
      Object.defineProperty(panel, 'active', { get: werfen });
      (panel.webview as unknown as { postMessage: () => never }).postMessage = werfen;
    };

    disposePanelsForServer('http://srv');

    expect(() => getActivePanel()).not.toThrow();
    expect(() => broadcastV12Mode()).not.toThrow();
    expect(() => broadcastSnippets()).not.toThrow();
  });
});
