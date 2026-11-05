// Fix M12: a failed SECONDARY query must not tip the panel into the
// error state.
//
// The path that was repaired: a throwing handler goes through
// `WebviewPanelHost#onError` in `dimensionBrowser.ts`, which posts `setError`,
// and `msgSession.ts` then switches off the whole table via
// `setViewPhase('error')`. That is right for the main query and wrong for
// filling a select field.
//
// Both are therefore checked: `_handleMessage` NO longer throws (only then
// does `onError` never get its turn), and nothing is posted that the client
// reads as an error phase — the message goes out through the warning
// channel.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));
vi.mock('../commands/mdx/mdxRunner', () => ({ MdxRunnerManager: { openWithMdx: vi.fn() } }));
vi.mock('../tm1Rest/dimensionElementsApi', () => ({
  fetchAttrDefs: vi.fn(),
  fetchHierarchyLevels: vi.fn(),
  fetchDefaultMember: vi.fn(),
  fetchViewRows: vi.fn(),
  fetchViewCount: vi.fn(),
}));
vi.mock('../tm1Rest/dimensionTreeApi', () => ({ fetchAncestors: vi.fn() }));
vi.mock('../commands/dimension/dimensionSubsetSave', () => ({
  SAVE_CANCELLED: Symbol('cancelled'),
  fetchSubsets: vi.fn(),
  fetchSubsetElements: vi.fn(),
  saveSubset: vi.fn(),
  saveExpressionSubset: vi.fn(),
}));

import * as vscode from 'vscode';
import { _handleMessage } from '../commands/dimension/dimensionBrowserHandlers';
import { fetchAttrDefs, fetchHierarchyLevels } from '../tm1Rest/dimensionElementsApi';
import { fetchAncestors } from '../tm1Rest/dimensionTreeApi';
import { fetchSubsets, fetchSubsetElements } from '../commands/dimension/dimensionSubsetSave';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

function fakePanel(): any {
  return { title: '', webview: { postMessage: vi.fn() }, dispose: vi.fn() };
}
const posted = (p: any): any[] => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);
const warned = (): string[] =>
  (vscode.window.showWarningMessage as any).mock.calls.map((c: any[]) => String(c[0]));

beforeEach(() => {
  vi.resetAllMocks();
  (vscode.window.showWarningMessage as any) = vi.fn();
});

// Each row: message → the module double that should throw.
const NEBENABFRAGEN: [string, Record<string, unknown>, () => any][] = [
  ['fetchAttrDefs', { type: 'fetchAttrDefs', dimName: 'D', hierName: 'D' }, () => fetchAttrDefs],
  ['fetchLevels', { type: 'fetchLevels', dimName: 'D', hierName: 'D' }, () => fetchHierarchyLevels],
  ['fetchSubsets', { type: 'fetchSubsets', dimName: 'D', hierName: 'D' }, () => fetchSubsets],
  ['fetchSubsetElements',
    { type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false },
    () => fetchSubsetElements],
];

describe('dimensionBrowserHandlers — secondary queries do not tip the panel', () => {
  for (const [name, msg, doubleOf] of NEBENABFRAGEN) {
    it(`${name} throws → warning, NO setError and no phase change`, async () => {
      (doubleOf() as any).mockRejectedValue(new Error('TM1 sagt nein'));
      const p = fakePanel();

      // 1. The router no longer lets the exception through — only this way does
      //    `WebviewPanelHost#onError` (and thus `setError`) never get its turn.
      await expect(_handleMessage(p, msg as never, CONFIG)).resolves.toBeUndefined();

      // 2. Nothing posted that the client reads as an error phase.
      const typen = posted(p).map((m) => m.type);
      expect(typen).not.toContain('setError');
      expect(typen).not.toContain('setLoading');

      // 3. It is still reported — no silent fallback.
      expect(warned().join(' | ')).toContain('TM1 sagt nein');
    });
  }

  it('a successful secondary query runs through unchanged', async () => {
    (fetchAttrDefs as any).mockResolvedValue([{ Name: 'Caption' }]);
    const p = fakePanel();
    await _handleMessage(p, { type: 'fetchAttrDefs', dimName: 'D', hierName: 'D' } as never, CONFIG);
    expect(posted(p)).toEqual([
      { type: 'attrDefs', dimName: 'D', hierName: 'D', defs: [{ Name: 'Caption' }] },
    ]);
    expect(warned()).toEqual([]);
  });

  it('drillAncestors: the error branch can be told apart from "no parents"', async () => {
    (fetchAncestors as any).mockRejectedValue(new Error('TM1 sagt nein'));
    const p = fakePanel();
    await _handleMessage(
      p,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: false } as never,
      CONFIG,
    );
    // The structure stays so that the client does not break …
    expect(posted(p)).toEqual([
      { type: 'ancestors', dimName: 'D', hierName: 'D', element: 'E', elements: [], edges: [] },
    ]);
    // … but the empty structure alone says nothing: the reason goes out through
    // the same reporting channel as for the `secondary` extras.

    expect(warned().join(' | ')).toContain('TM1 sagt nein');
  });
});
