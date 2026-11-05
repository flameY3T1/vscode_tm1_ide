import { describe, it, expect, vi, beforeEach } from 'vitest';

// Overwriting a subset replaces its content in place. The decision whether that destroys an
// MDX rule rests on a single `getSubset` read — so this suite pins what happens
// when that read does NOT come back with an answer.
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// S2-8 (review 2026-08-02): the REST half of the browser now lives in
// `tm1Rest/dimension{Elements,Tree}Api` + `tm1Rest/odataPaging`, which import the
// transport DIRECTLY — the `no-tm1client-in-deep-layers` rule forbids the facade
// below `commands/`. Point the deep path at the SAME doubles, or these tests
// reach the network and time out instead of failing.
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));
vi.mock('../commands/mdx/mdxRunner', () => ({ MdxRunnerManager: { openWithMdx: vi.fn() } }));
vi.mock('../tm1Rest/dimensionApi', () => ({
  listDimensionNames: vi.fn(),
  listHierarchyNames: vi.fn(),
}));
vi.mock('../tm1Rest/subsetApi', () => ({
  listSubsetInfos: vi.fn(),
  subsetExists: vi.fn(),
  deleteSubset: vi.fn(),
  createSubset: vi.fn(),
  updateSubset: vi.fn(),
  clearSubsetElements: vi.fn(),
  subsetElementCount: vi.fn(),
  listSubsetElementNames: vi.fn(),
  getSubset: vi.fn(),
}));

import * as vscode from 'vscode';
import { _handleMessage } from '../commands/dimension/dimensionBrowserHandlers';
import { getSubset, subsetExists, deleteSubset, createSubset, updateSubset, clearSubsetElements, subsetElementCount } from '../tm1Rest/subsetApi';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

function fakePanel(): any {
  return { title: '', webview: { postMessage: vi.fn() }, dispose: vi.fn() };
}
const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);

const save = (p: unknown) => _handleMessage(p as never, {
  type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S',
  isPrivate: false, overwrite: true, elements: ['A', 'B'],
} as never, CONFIG);

describe('saveSubset — overwriting a subset whose state could not be read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.window.showWarningMessage as any) = vi.fn();
    (subsetExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (deleteSubset as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (createSubset as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (updateSubset as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (clearSubsetElements as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // Overwrite reads the member count back to prove the write REPLACED the
    // list; the fixture saves two elements.
    (subsetElementCount as ReturnType<typeof vi.fn>).mockResolvedValue(2);
  });

  // Unknown state = no snapshot to restore if the member write fails, so the
  // save is refused outright instead of asking (review 2026-11-04, F2).
  it('refuses the overwrite without a prompt when getSubset reports ok:false', async () => {
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, Name: 'S', Expression: null, Alias: null,
    });
    const p = fakePanel();

    await save(p);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(updateSubset).not.toHaveBeenCalled();
    expect(clearSubsetElements).not.toHaveBeenCalled();
    expect(posted(p)).toContainEqual(expect.objectContaining({
      type: 'subsetSaveResult', ok: false, message: expect.stringContaining('could not be read'),
    }));
  });

  // The transport error path: a rejected promise lands in the caller's
  // `.catch(() => null)`, which used to read exactly like "static subset".
  it('refuses the overwrite when the getSubset call itself rejects', async () => {
    (getSubset as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNRESET'));
    const p = fakePanel();

    await save(p);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(updateSubset).not.toHaveBeenCalled();
    expect(deleteSubset).not.toHaveBeenCalled();
  });

  // A confirmed-static subset must stay friction-free — the warning is for the
  // cases where something can actually be lost.
  it('still does not prompt for a subset the server confirmed as static', async () => {
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, Name: 'S', Expression: null, Alias: null,
    });
    const p = fakePanel();

    await save(p);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(deleteSubset).not.toHaveBeenCalled();
    expect(updateSubset).toHaveBeenCalled();
  });

  // TM1's PATCH is not uniformly replace-semantics — on chores it APPENDS. A
  // subset that quietly ends up holding old plus new members is damage the user
  // only finds much later, so the count is read back and a mismatch is reported
  // at once.
  it('reports an overwrite that appended instead of replacing', async () => {
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, Name: 'S', Expression: null, Alias: null,
    });
    (subsetElementCount as ReturnType<typeof vi.fn>).mockResolvedValue(4); // 2 saved + 2 old
    const p = fakePanel();

    await save(p);

    expect(updateSubset).toHaveBeenCalled();
    expect(posted(p)).toContainEqual(expect.objectContaining({
      type: 'subsetSaveResult', ok: false,
      message: expect.stringContaining('4'),
    }));
  });

  // An unreadable probe is not evidence of damage — a save that went through
  // must not be reported as broken because the count call failed.
  it('stays silent when the member count cannot be read', async () => {
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, Name: 'S', Expression: null, Alias: null,
    });
    (subsetElementCount as ReturnType<typeof vi.fn>).mockResolvedValue(-1);
    const p = fakePanel();

    await save(p);

    expect(posted(p)).toContainEqual(expect.objectContaining({
      type: 'subsetSaveResult', ok: true,
    }));
  });

  it('keeps the dynamic-subset wording when the read succeeded', async () => {
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, Name: 'S', Expression: '{TM1SUBSETALL([D])}', Alias: null,
    });
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Convert');
    const p = fakePanel();

    await save(p);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('has an MDX expression'),
      { modal: true },
      'Convert',
    );
  });
});
