import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/defaultMemberApi', () => ({
  readDefaultMembers: vi.fn(),
  setDefaultMember: vi.fn(),
}));

const runCalls: string[] = [];
vi.mock('../runState/runRegistry', () => ({
  startRun: vi.fn(() => { runCalls.push('start'); return 'run#1'; }),
  finishRun: vi.fn(() => { runCalls.push('finish'); }),
}));

import { readDefaultMembers, setDefaultMember } from '../tm1Rest/defaultMemberApi';
import { _dimEditorTableForTest } from '../commands/dimension/dimensionEditor';

const mockRead = readDefaultMembers as unknown as ReturnType<typeof vi.fn>;
const mockSet = setDefaultMember as unknown as ReturnType<typeof vi.fn>;

function ctx() {
  const posted: unknown[] = [];
  return {
    posted,
    ctx: {
      panel: { webview: { postMessage: (m: unknown) => { posted.push(m); } } },
      dimName: 'D',
      hierName: 'D',
      config: { serverUrl: 'http://x' },
      api: {},
      setDirty: () => {},
      setDraftTooLarge: () => {},
    } as never,
  };
}

beforeEach(() => { mockRead.mockReset(); mockSet.mockReset(); runCalls.length = 0; });

describe('setDefaultMember handler', () => {
  it('reports success with the state read back', async () => {
    mockSet.mockResolvedValueOnce({ hierarchy: 'D', effective: 'A', explicit: 'A' });
    const { ctx: c, posted } = ctx();

    await _dimEditorTableForTest.setDefaultMember(
      { type: 'setDefaultMember', hier: 'D', element: 'A' } as never, c,
    );

    expect(posted).toContainEqual({
      type: 'defaultMemberResult', ok: true, hier: 'D',
      state: { hierarchy: 'D', effective: 'A', explicit: 'A' },
    });
  });

  it('reports the error text instead of throwing', async () => {
    mockSet.mockRejectedValueOnce(new Error('kaputt'));
    const { ctx: c, posted } = ctx();

    await _dimEditorTableForTest.setDefaultMember(
      { type: 'setDefaultMember', hier: 'D', element: 'A' } as never, c,
    );

    expect(posted).toContainEqual(
      expect.objectContaining({ type: 'defaultMemberResult', ok: false, message: 'kaputt' }),
    );
  });

  it('ends the run indicator in the error case too', async () => {
    mockSet.mockRejectedValueOnce(new Error('kaputt'));
    const { ctx: c } = ctx();

    await _dimEditorTableForTest.setDefaultMember(
      { type: 'setDefaultMember', hier: 'D', element: null } as never, c,
    );

    expect(runCalls).toEqual(['start', 'finish']);
  });
});

describe('fetchHier handler', () => {
  it('sends along the default-member state of the lazily loaded hierarchy', async () => {
    mockRead.mockResolvedValueOnce([{ hierarchy: 'alt', effective: 'AltTop', explicit: '' }]);
    const { ctx: c, posted } = ctx();
    (c as { api: unknown }).api = { fetchHierarchyContent: async () => ({ elements: [], edges: [], attrDefs: [] }) };

    await _dimEditorTableForTest.fetchHier({ type: 'fetchHier', hier: 'alt' } as never, c);

    expect(posted).toContainEqual({
      type: 'defaultMemberState',
      states: [{ hierarchy: 'alt', effective: 'AltTop', explicit: '' }],
    });
  });

  it('does not let a read error derail the hierarchy switch', async () => {
    mockRead.mockRejectedValueOnce(new Error('egal'));
    const { ctx: c, posted } = ctx();
    (c as { api: unknown }).api = { fetchHierarchyContent: async () => ({ elements: [], edges: [], attrDefs: [] }) };

    await _dimEditorTableForTest.fetchHier({ type: 'fetchHier', hier: 'alt' } as never, c);

    expect(posted).toContainEqual(expect.objectContaining({ type: 'mergeHier', hier: 'alt' }));
  });
});
