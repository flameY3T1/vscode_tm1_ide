import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../commands/processEditor/debugSession', () => ({ cleanupDebugSession: vi.fn() }));

import { onPanelDisposed } from '../commands/processEditor/lifecycle';
import { _sessions, configureProcessEditor, type PanelSession } from '../commands/processEditor/state';
import { testSession } from './helpers/processEditorSession';
import { loadDraft, hasDraft, type DraftMemento } from '../commands/processEditor/draftStore';

/** In-memory `globalState`. */
function fakeContext() {
  const raw: Record<string, unknown> = {};
  const globalState: DraftMemento = {
    get: <T,>(k: string, d: T) => (raw[k] as T) ?? d,
    update: async (k: string, v: unknown) => { raw[k] = v; },
  };
  return { context: { globalState } as never, memento: globalState };
}

const KEY = 'http://srv|MyProcess';

const DRAFT = {
  sections: { prolog: 'sTest = 1;', metadata: '', data: '', epilog: '' },
  parameters: [], dataSource: { Type: 'None' }, variables: [],
};

let mem: DraftMemento;
let session: PanelSession;

beforeEach(() => {
  _sessions.clear();
  session = testSession({} as never, KEY, 'MyProcess', 'http://srv');
  const f = fakeContext();
  mem = f.memento;
  configureProcessEditor({ context: f.context });
});

describe('process editor draft recovery', () => {
  it('parks the mirrored draft when a DIRTY panel is disposed', async () => {
    session.dirty = true;
    session.draft = DRAFT;

    await onPanelDisposed(session);

    expect(loadDraft(mem, KEY)?.sections.prolog).toBe('sTest = 1;');
  });

  it('parks nothing when the panel was clean', async () => {
    session.dirty = false;
    session.draft = DRAFT;

    await onPanelDisposed(session);

    expect(hasDraft(mem, KEY)).toBe(false);
  });

  it('parks nothing when no content was ever mirrored', async () => {
    session.dirty = true;

    await onPanelDisposed(session);

    expect(hasDraft(mem, KEY)).toBe(false);
  });

  it('still clears the in-memory panel state after parking', async () => {
    session.dirty = true;
    session.draft = DRAFT;
    session.code = { prolog: '', metadata: '', data: '', epilog: '' } as never;

    // openPanel's onDidDispose drops the registry entry synchronously, then
    // hands the closed session to onPanelDisposed.
    _sessions.delete(KEY);
    await onPanelDisposed(session);

    // Parking must not bring the closed panel's state back into the registry.
    expect(hasDraft(mem, KEY)).toBe(true);
    expect(_sessions.has(KEY)).toBe(false);
  });

  it('parking the old draft leaves a successor under the same key untouched', async () => {
    session.dirty = true;
    session.draft = DRAFT;
    _sessions.delete(KEY);
    const successor = testSession({} as never, KEY, 'MyProcess', 'http://srv');
    successor.ready = true;
    successor.code = { prolog: 'p', metadata: '', data: '', epilog: '' } as never;

    await onPanelDisposed(session);

    expect(_sessions.get(KEY)).toBe(successor);
    expect(successor.ready).toBe(true);
    expect(successor.code).toBeDefined();
    expect(successor.dirty).toBe(false);
  });

  it('does not throw when no extension context is configured', async () => {
    configureProcessEditor({ context: undefined });
    session.dirty = true;
    session.draft = DRAFT;
    _sessions.delete(KEY);

    await expect(onPanelDisposed(session)).resolves.toBeUndefined();
    expect(_sessions.has(KEY)).toBe(false);
  });
});
