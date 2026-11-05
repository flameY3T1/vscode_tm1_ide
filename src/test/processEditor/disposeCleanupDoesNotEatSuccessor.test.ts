/**
 * Intermittently empty process editor, reported 2026-09-01: a click on a
 * process opens an empty window, another process loads normally, and
 * the next time the same process is opened it works again.
 *
 * The cause was `onPanelDisposed`: it cleared the state maps only AFTER
 * `await saveDraft(…)`. The maps are keyed by `serverKey|processName`
 * and carry no reference to a panel — if you close a process with
 * unsaved changes and reopen it right away, the delayed cleanup
 * clears the table out from under the SUCCESSOR:
 *
 *   `_readyPanels.delete(key)` → after the fetch, `openPanel` finds
 *   `_readyPanels.has(key) === false`, posts no content, the panel stays empty.
 *   `_panels.delete(key)`     → the new panel is no longer in any registry,
 *                               so the next click opens a fresh one
 *                               (which then loads) instead of revealing it.
 *
 * Reproduced with a `saveDraft` that only completes on command.
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

let releaseSave: (() => void) | undefined;
vi.mock('../../commands/processEditor/draftStore', () => ({
  saveDraft: vi.fn(() => new Promise<void>(resolve => { releaseSave = resolve; })),
  loadDraft: vi.fn(() => undefined),
  hasDraft: vi.fn(() => false),
  clearDraft: vi.fn(),
}));

import { openProcess } from '../../commands/processEditor/openPanel';
// Static, even though nothing from it is called here: `openPanel` reaches
// `onPanelDisposed` via a dynamic import. Without this line the
// first module load falls into the middle of the test and the cleanup only runs
// after the assertions.
import '../../commands/processEditor/lifecycle';
import {
  _sessions, configureProcessEditor, draftKeyOf, panelKey, sessionScope,
} from '../../commands/processEditor/state';
import { clearWindowsForTest } from '../../workbench/windowRegistry';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CONFIG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;
const KEY = panelKey(sessionScope(CONFIG), 'MyProcess');

const DRAFT = {
  sections: { prolog: 'x', metadata: '', data: '', epilog: '' },
  parameters: [], dataSource: { Type: 'None' }, variables: [],
};

/** Lets all pending microtasks (dynamic import + `.then`) run through. */
const flush = async (): Promise<void> => {
  // `setTimeout`, not just microtasks: `openPanel` hands the close on to
  // `lifecycle` via a DYNAMIC import — the first time that is a real
  // module load, which sits behind a macrotask.
  for (let i = 0; i < 3; i++) { await new Promise(resolve => setTimeout(resolve, 0)); }
};

describe('process editor: delayed cleanup must not empty the successor', () => {
  beforeEach(() => {
    releaseSave = undefined;
    clearWindowsForTest();
    _sessions.clear();
    configureProcessEditor({
      extensionUri: vscode.Uri.file(process.cwd()),
      context: { globalState: { get: vi.fn(), update: vi.fn(), keys: () => [] } } as never,
    });
  });

  it('close with a draft, reopen immediately: the markers of the new panel survive', async () => {
    expect(await openProcess('MyProcess', undefined, CONFIG)).toBe(true);
    const first = _sessions.get(KEY)!.panel;

    // Unsaved changes — only then does the path go through `saveDraft`.
    _sessions.get(KEY)!.dirty = true;
    _sessions.get(KEY)!.draft = DRAFT;

    first.dispose();
    await flush();
    // `saveDraft` now hangs: the old cleanup run is stuck in the middle of it.
    expect(releaseSave).toBeDefined();

    // The user clicks the same process again right away.
    expect(await openProcess('MyProcess', undefined, CONFIG)).toBe(true);
    const second = _sessions.get(KEY)?.panel;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    // The new window reports `monacoReady`.
    _sessions.get(KEY)!.ready = true;

    // Only NOW does saving the old draft complete.
    releaseSave!();
    await flush();

    expect(_sessions.get(KEY)?.ready).toBe(true);     // otherwise the editor stays empty
    expect(_sessions.get(KEY)?.code).toBeDefined();   // otherwise it has nothing to post
    expect(_sessions.get(KEY)?.panel).toBe(second);   // otherwise the next click opens a second one
  });

  it('the draft of the closed panel is still parked', async () => {
    await openProcess('MyProcess', undefined, CONFIG);
    _sessions.get(KEY)!.dirty = true;
    _sessions.get(KEY)!.draft = DRAFT;

    _sessions.get(KEY)!.panel.dispose();
    await flush();

    const { saveDraft } = await import('../../commands/processEditor/draftStore');
    // The parked draft stays keyed by URL + name, independent of the login.
    expect(saveDraft).toHaveBeenCalledWith(expect.anything(), draftKeyOf('http://srv', 'MyProcess'), DRAFT, expect.any(Number));
  });
});
