import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// S2-8 (review 2026-08-02): the REST half of the browser now lives in
// `tm1Rest/dimension{Elements,Tree}Api` + `tm1Rest/odataPaging`, which import the
// transport DIRECTLY — the `no-tm1client-in-deep-layers` rule forbids the facade
// below `commands/`. Point the deep path at the SAME doubles, or these tests
// reach the network and time out instead of failing.
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../commands/dimension/dimensionBrowserWebview', () => ({ getHtml: vi.fn(() => '<html></html>') }));
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../serverState/state', async () => await import('../commands/serverManager'));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));
vi.mock('../commands/mdx/mdxRunner', () => ({ MdxRunnerManager: { openWithMdx: vi.fn() } }));
vi.mock('../tm1Rest/dimensionApi', () => ({
  listDimensionNames: vi.fn(),
  listHierarchyNames: vi.fn(),
}));
vi.mock('../tm1Rest/cubeApi', () => ({ getCube: vi.fn() }));
vi.mock('../tm1Rest/subsetApi', () => ({
  listSubsetNames: vi.fn(),
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
import {
  _handleMessage, openDimensionBrowser, initializeDimensionBrowser,
  disposeDimensionBrowserForServer,
} from '../commands/dimension/dimensionBrowser';
import { apiRequest } from '../tm1Client';
import { listDimensionNames, listHierarchyNames } from '../tm1Rest/dimensionApi';
import {
  listSubsetInfos, listSubsetElementNames, subsetElementCount,
  getSubset, subsetExists, deleteSubset, createSubset, updateSubset, clearSubsetElements,
} from '../tm1Rest/subsetApi';
import { _clearSubsetReadStateForTest } from '../commands/dimension/dimensionSubsetSave';
import { MdxRunnerManager } from '../commands/mdx/mdxRunner';
import { getCube } from '../tm1Rest/cubeApi';

const CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', rejectUnauthorized: false, authType: 'Basic' as const };

function fakePanel(): any {
  const panel: any = {
    title: '',
    webview: { postMessage: vi.fn() },
    dispose: vi.fn(),
  };
  return panel;
}
const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);

// `resetAllMocks` instead of `clearAllMocks`: `clear` only wipes the call lists and
// leaves unconsumed `mockResolvedValueOnce` queues as well as set return values
// in place (e.g. `listSubsetElementNames -> complete:false`).
// The factory implementations passed to `vi.fn(impl)` survive the reset.
// On top of that, the module state of `dimensionSubsetSave`: the note "last read
// was incomplete" lives in a module-level Set and outlasts every test.
beforeEach(() => {
  vi.resetAllMocks();
  _clearSubsetReadStateForTest();
  (vscode.window.showWarningMessage as any) = vi.fn();
  // The panel registry of `dimensionBrowser` is module-wide and survives every
  // reset. If a view from an earlier test is still in it, `openDimensionBrowser`
  // only SHOWS it again instead of building a new one — `createWebviewPanel`
  // is then never called at all, and a test that reaches for its panel via
  // `mock.results[0]` grabs nothing. Since the tests are also shuffled within
  // a file (`shuffle.tests`, 2026-09-19), this depends on the order; before
  // that it just happened to run the right way round.
  for (const url of ['http://tm1:8001', 'http://other:1']) {
    disposeDimensionBrowserForServer(url);
  }
});

describe('dimensionBrowser._handleMessage — router', () => {
  it('fetchHierarchies — posts setHierarchies, default hier first', async () => {
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockResolvedValue(['}Leaves_D', 'D']);
    const p = fakePanel();
    await _handleMessage(p, { type: 'fetchHierarchies', dimName: 'D' } as never, CONFIG);
    expect(posted(p)).toContainEqual({ type: 'setHierarchies', hiers: ['D', '}Leaves_D'], selectedHier: 'D', selectedDim: 'D' });
  });

  it('selectionConfirmed — invokes onSelect and disposes panel', async () => {
    const onSelect = vi.fn();
    const p = fakePanel();
    await _handleMessage(p, { type: 'selectionConfirmed', selection: { foo: 1 }, displayAlias: 'German' } as never, CONFIG, { mode: 'selection', onSelect } as never);
    expect(onSelect).toHaveBeenCalledWith({ foo: 1 }, 'German', undefined);
    expect(p.dispose).toHaveBeenCalled();
  });

  it('openMdxRunner — warns when mdx empty', async () => {
    const p = fakePanel();
    await _handleMessage(p, { type: 'openMdxRunner', mdx: '' } as never, CONFIG);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(MdxRunnerManager.openWithMdx).not.toHaveBeenCalled();
  });

  it('openMdxRunner — opens runner with mdx when present', async () => {
    const p = fakePanel();
    await _handleMessage(p, { type: 'openMdxRunner', mdx: 'SELECT' } as never, CONFIG);
    expect(MdxRunnerManager.openWithMdx).toHaveBeenCalledWith(CONFIG, 'Srv', 'SELECT');
  });

  it('openAttrCube — opens attribute cube via command when it exists', async () => {
    const p = fakePanel();
    vi.mocked(getCube).mockResolvedValueOnce({} as never);
    await _handleMessage(p, { type: 'openAttrCube', dimName: 'D' } as never, CONFIG);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'tm1.internal.openCubeByName', '}ElementAttributes_D', CONFIG,
    );
  });

  it('openAttrCube — warns and does not open when cube missing', async () => {
    const p = fakePanel();
    vi.mocked(getCube).mockRejectedValueOnce(new Error('404'));
    await _handleMessage(p, { type: 'openAttrCube', dimName: 'D' } as never, CONFIG);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'tm1.internal.openCubeByName', expect.anything(), expect.anything(),
    );
  });

  it('openDimensionEditor — opens the editor via command on the shown dim/hier', async () => {
    const p = fakePanel();
    await _handleMessage(p, { type: 'openDimensionEditor', dimName: 'D', hierName: 'H' } as never, CONFIG);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'tm1.internal.openDimensionEditor', 'D', CONFIG, 'H',
    );
  });

  it('openDimensionEditor — empty hierName falls back to the default hierarchy', async () => {
    const p = fakePanel();
    await _handleMessage(p, { type: 'openDimensionEditor', dimName: 'D', hierName: '' } as never, CONFIG);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'tm1.internal.openDimensionEditor', 'D', CONFIG, undefined,
    );
  });




  it('fetchSubsets — posts setSubsets with public+private and the dynamic flag', async () => {
    (listSubsetInfos as ReturnType<typeof vi.fn>).mockResolvedValue({
      pub: [{ name: 'All', isDynamic: true }],
      priv: [{ name: 'Mine', isDynamic: false }],
    });
    const p = fakePanel();
    await _handleMessage(p, { type: 'fetchSubsets', dimName: 'D', hierName: 'D' } as never, CONFIG);
    expect(posted(p)).toContainEqual({
      type: 'setSubsets', dimName: 'D', hierName: 'D',
      subsets: [
        { name: 'All', isPrivate: false, isDynamic: true },
        { name: 'Mine', isPrivate: true, isDynamic: false },
      ],
    });
  });

  it('fetchSubsetElements — posts setSubsetElements incl. the subset MDX and its display alias', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A', 'B'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'S', Expression: '{TM1SUBSETALL([D])}', Alias: 'German' });
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual({
      type: 'setSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
      elements: ['A', 'B'], expression: '{TM1SUBSETALL([D])}', alias: 'German',
    });
  });

  // The alias is what the subset was saved to display its members under; without
  // it the browser opens every subset under raw element names.
  it('fetchSubsetElements — a subset without an alias reports alias null', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'S', Expression: null, Alias: null });
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({ type: 'setSubsetElements', alias: null }));
  });

  it('fetchSubsetElements — a static subset reports expression null', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'S', Expression: null });
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({ type: 'setSubsetElements', expression: null }));
  });

  // The elements still load — but the reply must say that the EXPRESSION is
  // unread rather than let `expression: null` pass as "this subset is static".
  it('fetchSubsetElements — a failing getSubset marks the expression unread', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({
      type: 'setSubsetElements', elements: ['A'], expression: null, expressionUnread: true,
    }));
  });

  it('fetchSubsetElements — a non-2xx read (ok:false) counts as unread too', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, Name: 'S', Expression: null, Alias: null });
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({ expressionUnread: true }));
  });

  it('fetchSubsetElements — a successful read carries no unread flag', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, Name: 'S', Expression: null, Alias: null });
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
    } as never, CONFIG);
    const msg = posted(p).find((m: { type?: string }) => m.type === 'setSubsetElements') as Record<string, unknown>;
    expect(msg.expressionUnread).toBeUndefined();
  });

  // Every fetch is an independent REST pair, so replies can land out of order —
  // the echo is what lets the webview drop one that answers an old dim/hier.
  it('fetchSubsetElements — echoes the request dim/hier back verbatim', async () => {
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['A'], complete: true });
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'S', Expression: null });
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'fetchSubsetElements', dimName: 'Region', hierName: 'Alt', subsetName: 'S', isPrivate: true,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({
      type: 'setSubsetElements', dimName: 'Region', hierName: 'Alt', subsetName: 'S', isPrivate: true,
    }));
  });

  it('fetchDefaultMember — posts resolved name', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ Name: 'Total' }) });
    const p = fakePanel();
    await _handleMessage(p, { type: 'fetchDefaultMember', dimName: 'D', hierName: 'D' } as never, CONFIG);
    expect(posted(p)).toContainEqual({ type: 'setDefaultMember', name: 'Total' });
  });

  it('saveSubset — rejects empty name', async () => {
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: '  ', elements: ['A'], isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({ type: 'subsetSaveResult', ok: false }));
  });

  it('saveSubset — rejects when no elements and no expression', async () => {
    const p = fakePanel();
    await _handleMessage(p, {
      type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S', elements: [], expression: '', isPrivate: false,
    } as never, CONFIG);
    expect(posted(p)).toContainEqual(expect.objectContaining({ type: 'subsetSaveResult', ok: false }));
  });

  // ── Warn before flattening a dynamic subset (the overwrite loses the MDX) ──
  describe('saveSubset — overwriting a DYNAMIC subset', () => {
    beforeEach(() => {
      (subsetExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (deleteSubset as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (createSubset as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    const save = (p: unknown) => _handleMessage(p as never, {
      type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S',
      isPrivate: false, overwrite: true, elements: ['A', 'B'],
    } as never, CONFIG);

    it('asks for confirmation and does NOT delete when the user cancels', async () => {
      (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'S', Expression: '{TM1SUBSETALL([D])}' });
      (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const p = fakePanel();

      await save(p);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('has an MDX expression'),
        { modal: true },
        'Convert',
      );
      expect(deleteSubset).not.toHaveBeenCalled();
      expect(createSubset).not.toHaveBeenCalled();
      // The webview must be told, or its "saving…" state never clears.
      expect(posted(p)).toContainEqual(expect.objectContaining({
        type: 'subsetSaveResult', ok: false, cancelled: true,
      }));
    });

    // Live 2026-08-02: TM1 refuses to DELETE a subset a view refers to
    // (HTTP 400 "subset being used by view"), so an overwrite writes over the
    // existing subset instead of recreating it. `Expression: ''` carries the
    // flatten the user just confirmed — without it the subset would keep its
    // rule and ignore the member list.
    it('overwrites in place once the user confirms, without deleting first', async () => {
      (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, Name: 'S', Expression: '{TM1SUBSETALL([D])}' });
      (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Convert');
      const p = fakePanel();

      await save(p);

      expect(deleteSubset).not.toHaveBeenCalled();
      expect(createSubset).not.toHaveBeenCalled();
      // Three steps, in this order: drop the rule, clear the list, write.
      // They cannot be combined — a body with an element list AND an Expression is
      // rejected with `Encountered both a list of Elements and an Expression`,
      // and an Elements PATCH appends instead of replacing (both live on 11.8).
      const calls = (updateSubset as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      const [, , , name1, body1] = calls[0];
      expect(name1).toBe('S');
      expect(body1).toEqual({ Expression: '' });
      expect(clearSubsetElements).toHaveBeenCalled();
      const [, , , name2, body2] = calls[1];
      expect(name2).toBe('S');
      // A Name in a PATCH body would read as a rename.
      expect(body2).not.toHaveProperty('Name');
      expect(body2).not.toHaveProperty('Expression');
      expect(body2).toHaveProperty('Elements@odata.bind');
      expect(posted(p)).toContainEqual(expect.objectContaining({ type: 'subsetSaveResult', ok: true }));
    });

    // B1: the member list the overwrite writes comes from `listSubsetElementNames`.
    // That read ends early when a page fails, so writing it back would shorten a
    // production subset — with a save that looks completely normal.
    it('refuses to overwrite after an incomplete element read', async () => {
      (listSubsetElementNames as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ elements: ['A'], complete: false, statusCode: 500 });
      (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'S', Expression: null });
      const p = fakePanel();

      // The read that armed the editor…
      await _handleMessage(p as never, {
        type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
      } as never, CONFIG);
      // …and the save that must not trust it.
      await save(p);

      expect(updateSubset).not.toHaveBeenCalled();
      expect(clearSubsetElements).not.toHaveBeenCalled();
      expect(posted(p)).toContainEqual(expect.objectContaining({
        type: 'subsetSaveResult', ok: false,
      }));
    });

    it('allows the overwrite again once the read completed', async () => {
      (listSubsetElementNames as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ elements: ['A'], complete: false, statusCode: 500 });
      (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, Name: 'S', Expression: null });
      const p = fakePanel();
      await _handleMessage(p as never, {
        type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
      } as never, CONFIG);

      (listSubsetElementNames as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ elements: ['A', 'B'], complete: true });
      await _handleMessage(p as never, {
        type: 'fetchSubsetElements', dimName: 'D', hierName: 'D', subsetName: 'S', isPrivate: false,
      } as never, CONFIG);
      await save(p);

      expect(updateSubset).toHaveBeenCalled();
    });

    it('does not prompt when the target subset is static', async () => {
      (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, Name: 'S', Expression: null });
      const p = fakePanel();

      await save(p);

      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(deleteSubset).not.toHaveBeenCalled();
      expect(updateSubset).toHaveBeenCalled();
    });

    it('does not prompt when the subset does not exist yet (nothing to lose)', async () => {
      (subsetExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const p = fakePanel();

      await save(p);

      expect(getSubset).not.toHaveBeenCalled();
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(deleteSubset).not.toHaveBeenCalled();
      expect(createSubset).toHaveBeenCalled();
    });
  });

  // ── The display alias travels with the save ───────────────────────────────
  // Overwriting clears the alias unless the body carries one, so an omitted
  // alias is gone for good. Before this, every overwrite silently dropped it.
  describe('saveSubset — display alias', () => {
    beforeEach(() => {
      (subsetExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (createSubset as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });
    const bodyOf = (): Record<string, unknown> =>
      (createSubset as ReturnType<typeof vi.fn>).mock.calls[0][3] as Record<string, unknown>;

    it('writes the active alias into the POST body of an element subset', async () => {
      await _handleMessage(fakePanel() as never, {
        type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S',
        isPrivate: false, overwrite: false, elements: ['A'], displayAlias: 'German',
      } as never, CONFIG);
      expect(bodyOf()).toEqual(expect.objectContaining({ Alias: 'German' }));
    });

    it('writes the active alias into the POST body of an MDX subset', async () => {
      await _handleMessage(fakePanel() as never, {
        type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S',
        isPrivate: false, overwrite: false, elements: [],
        expression: '{TM1SUBSETALL([D])}', displayAlias: 'German',
      } as never, CONFIG);
      expect(bodyOf()).toEqual(expect.objectContaining({
        Alias: 'German', Expression: '{TM1SUBSETALL([D])}',
      }));
    });

    // No alias active means "show raw names" — sending Alias:'' would be a
    // write the user never asked for, so the property stays off the body.
    it('omits Alias entirely when no alias is active', async () => {
      await _handleMessage(fakePanel() as never, {
        type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S',
        isPrivate: false, overwrite: false, elements: ['A'], displayAlias: '',
      } as never, CONFIG);
      expect(bodyOf()).not.toHaveProperty('Alias');
    });

    it('omits Alias when the message carries none at all (older webview)', async () => {
      await _handleMessage(fakePanel() as never, {
        type: 'saveSubset', dimName: 'D', hierName: 'D', subsetName: 'S',
        isPrivate: false, overwrite: false, elements: ['A'],
      } as never, CONFIG);
      expect(bodyOf()).not.toHaveProperty('Alias');
    });
  });

  // ── Large-dim lever 3/4/5: count probe, paged mode, server filter ──────────

  // Since 2026-08-18 there is NO second load path any more. Before that,
  // `LARGE_DIM_THRESHOLD` = 50,000 decided between paging and a full load with edges,
  // and only the paging path had the August rework (index order, every element once,
  // `_windowBaseMembers`). A small dimension therefore got an edge DFS with
  // duplicate rows and a dynamic MDX that degraded on it.

  // Guard against the regression: NO element count may open up the second path
  // again. A `setElements` in reply to `fetchElements` would mean that two
  // different representations of the same set are back.

  // Since 2026-08-08 the element page fetch always goes through the
  // MDX path (`ExecuteMDXSetExpression`), no longer through OData `$filter`: only it
  // returns the parent for the indentation and can search in attribute values.



  // The `@odata.nextLink` case belonged to the OData paging path, which the
  // element fetch no longer takes since 2026-08-08. `ExecuteMDXSetExpression`
  // returns a window via `Tuples($skip;$top)` and the total count as
  // `Cardinality` — there is no next link. The load-more logic now sits in the
  // webview (scrolling → next offset), not in the transport.

  // ── Leak 2: count-probe failure must NOT fall back to whole-dim load ───────


  // ── Leak 1: attribute fetch must be bounded (paged), not whole-dim ─────────






  // S2-2/S2-1: the walk no longer dumps the hierarchy's whole /Edges collection —
  // it asks each level for `$expand=Parents` by name. The unrelated `OTHER>Z`
  // edge is gone from the fixture because it can no longer even be fetched;
  // dimBrowserHostRequestShape.test.ts pins the request shape itself.
  const PARENTS: Record<string, string[]> = { E: ['P1', 'P2'], P1: ['GP'], P2: ['GP'], GP: [] };
  function mockParentLevels(): void {
    (apiRequest as any).mockImplementation((_m: string, url: string) => {
      const f = /[&?]\$filter=([^&]*)/.exec(String(url));
      const asked = f ? Array.from(decodeURIComponent(f[1]).matchAll(/Name eq '([^']*)'/g)).map((m) => m[1]) : [];
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({
        value: asked.map((n) => ({
          Name: n, Type: 'Consolidated', Level: 1,
          Parents: (PARENTS[n] ?? []).map((p) => ({ Name: p })),
        })),
      }) });
    });
  }

  it('drillAncestors recursive — walked upward level by level, posts ancestors + path edges', async () => {
    const p = fakePanel();
    mockParentLevels();
    await _handleMessage(p, { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: true } as never, CONFIG);
    const sent = posted(p).find((m: any) => m.type === 'ancestors');
    expect(sent).toBeTruthy();
    expect(sent.element).toBe('E');
    // K11: without dim/hier in the reply the client cannot recognise a straggler
    // from a hierarchy it has already left.
    expect(sent.dimName).toBe('D');
    expect(sent.hierName).toBe('D');
    expect(sent.elements.map((e: any) => e.Name).sort()).toEqual(['GP', 'P1', 'P2']);
    expect(sent.edges.map((e: any) => e.ParentName + '>' + e.ComponentName).sort()).toEqual(
      ['GP>P1', 'GP>P2', 'P1>E', 'P2>E']);
  });

  it('drillAncestors non-recursive — only direct parents posted', async () => {
    const p = fakePanel();
    mockParentLevels();
    await _handleMessage(p, { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: false } as never, CONFIG);
    const sent = posted(p).find((m: any) => m.type === 'ancestors');
    expect(sent.elements.map((e: any) => e.Name)).toEqual(['P1', 'P2']); // GP NOT walked
    expect(sent.edges).toEqual([
      { ParentName: 'P1', ComponentName: 'E' },
      { ParentName: 'P2', ComponentName: 'E' },
    ]);
  });
});


// P1-8b (stage 4 race protocols): openDimensionBrowser posts setLoading/setMode
// (and conditionally setSubsetExpression) synchronously right after registering
// onDidReceiveMessage — before the async _fetchDimensions() call. If the client's
// message listener isn't wired yet (webview cold-start), that eager post can be
// lost. The webviewReady handshake (mirrors cubeViewer/mdxRunner) is the safety
// net: host stashes the init payloads and resends them when the client signals
// its listener is registered.
describe('dimensionBrowser webviewReady handshake (P1-8b)', () => {
  function lastPanel(): any {
    const calls = (vscode.window.createWebviewPanel as any).mock.results;
    return calls[calls.length - 1].value;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    (vscode.window.showWarningMessage as any) = vi.fn();
    (listDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D']);
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D']);
    initializeDimensionBrowser(vscode.Uri.file('/ext'));
  });

  it('resends the setMode selection-config payload on webviewReady', async () => {
    const onSelect = vi.fn();
    const options = {
      mode: 'selection' as const,
      multiSelect: true,
      allowedTypes: ['N'],
      initialSelection: ['A'],
      onSelect,
    };

    // Selection mode always opens a fresh panel — call without awaiting so we
    // can inspect the eager post that happens synchronously before the first
    // await inside openDimensionBrowser (mirrors mdxRunnerHandshake.test.ts).
    const openPromise = openDimensionBrowser('D', CONFIG, options as never);
    const panel = lastPanel();

    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'setMode', mode: 'selection', multiSelect: true, initialSelection: ['A'],
    }));

    await openPromise;

    // Simulate a late-registering client: clear the eager posts, then fire
    // webviewReady exactly like the real webview does once its listener is wired.
    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });

    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'setMode', mode: 'selection', multiSelect: true, initialSelection: ['A'],
    }));
  });

  // Reported 2026-09-20: "sometimes I click on a dimension and the spinner
  // keeps turning, there is a query on the server, and no data is shown
  // to me. Closing and reopening works."
  //
  // `setHierarchies` is the message that triggers `startView`/`fetchRows()` in
  // the webview — without it NO row is ever fetched. It is posted after the
  // `await` of the hierarchy query; that single round trip to TM1 was the whole
  // time window the bundle in the frame had to load. If that was not enough,
  // the message was gone and nothing fetched it back: `setMode` was tied to the
  // handshake, the three load messages were not.
  it('resends the load messages on webviewReady — otherwise the spinner turns forever', async () => {
    await openDimensionBrowser('D', CONFIG);
    const panel = lastPanel();

    // The late-registering client: everything posted so far counts as lost.
    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });

    const typen = posted(panel).map((m: any) => m.type);
    expect(typen).toContain('setHierarchies');
    expect(typen).toContain('attrColumns');
    // Same order as the first time: the columns BEFORE the hierarchies, otherwise
    // the first window fetches without them and reloads immediately (see `_loadDimension`).
    expect(typen.indexOf('attrColumns')).toBeLessThan(typen.indexOf('setHierarchies'));
  });

  it('resends an error message from opening as well', async () => {
    // A lost `setError` would leave an empty window without any
    // explanation — the worst outcome of all.
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('TM1 weg'));
    await openDimensionBrowser('D', CONFIG);
    const panel = lastPanel();

    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });

    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'setError', message: expect.stringContaining('TM1 weg'),
    }));
  });

  // A second handshake means the iframe was rebuilt — "Move into New Window"
  // reloads the webview despite `retainContextWhenHidden`. It used to get
  // nothing back (the resend list was already drained) and the spinner turned
  // forever. It must load the dimension again: once, not replayed on top.
  it('loads the dimension again on a second webviewReady (panel moved to a new window)', async () => {
    await openDimensionBrowser('D', CONFIG);
    const panel = lastPanel();
    panel.simulateMessage({ type: 'webviewReady' });
    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });
    await vi.waitFor(() => {
      expect(posted(panel).filter((m: any) => m.type === 'setHierarchies')).toHaveLength(1);
    });
    const typen = posted(panel).map((m: any) => m.type);
    expect(typen.indexOf('attrColumns')).toBeLessThan(typen.indexOf('setHierarchies'));
  });

  it('happy path unaffected — setMode still posted exactly once without webviewReady', async () => {
    const options = { mode: 'selection' as const, multiSelect: false };
    await openDimensionBrowser('D', CONFIG, options as never);
    const panel = lastPanel();
    const setModeCount = posted(panel).filter((m: any) => m.type === 'setMode').length;
    expect(setModeCount).toBe(1);
  });

  it('standalone mode (no options → no setMode) — webviewReady does not throw or post setMode', async () => {
    await openDimensionBrowser('D', CONFIG);
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();
    expect(() => panel.simulateMessage({ type: 'webviewReady' })).not.toThrow();
    expect(posted(panel).some((m: any) => m.type === 'setMode')).toBe(false);
  });

  it('does not throw when webviewReady arrives after the panel was disposed', async () => {
    const options = { mode: 'selection' as const, multiSelect: false };
    await openDimensionBrowser('D', CONFIG, options as never);
    const panel = lastPanel();
    panel.dispose();
    expect(() => panel.simulateMessage({ type: 'webviewReady' })).not.toThrow();
  });
});

// One panel per server+dimension: the second subset of the SAME dimension lands in
// the panel that is already open. Reveal alone is not enough then — without a fresh
// setMode the panel would stay on the subset that was opened first.
describe('dimensionBrowser — opening a second subset of the same dimension switches to it', () => {
  function lastPanel(): any {
    const calls = (vscode.window.createWebviewPanel as any).mock.results;
    return calls[calls.length - 1].value;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    (vscode.window.showWarningMessage as any) = vi.fn();
    (listDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['DSW']);
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockResolvedValue(['DSW']);
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ Name: 'SubB', Expression: '{ [DSW].[B] }' });
    initializeDimensionBrowser(vscode.Uri.file('/ext'));
  });

  function openSubset(name: string): Promise<void> {
    return openDimensionBrowser('DSW', CONFIG, {
      mode: 'standalone', multiSelect: false, initialSubset: { name, isPrivate: false },
    } as never);
  }

  it('re-posts setMode with the newly clicked subset instead of only revealing', async () => {
    await openSubset('SubA');
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();

    await openSubset('SubB');

    // No second panel — the same dimension shares one.
    expect(lastPanel()).toBe(panel);
    expect((vscode.window.createWebviewPanel as any).mock.calls.length).toBe(1);
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'setMode', initialSubset: { name: 'SubB', isPrivate: false },
    }));
    panel.dispose();
  });

  // Reveal with SubB, then the iframe reloads (moved into a new window): the
  // replay must land on SubB, not on the subset the panel was first opened with.
  it('a webviewReady after the reveal replays the newly clicked subset', async () => {
    await openSubset('SubA');
    const panel = lastPanel();
    panel.simulateMessage({ type: 'webviewReady' });
    await openSubset('SubB');
    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });
    const modes = posted(panel).filter((m: any) => m.type === 'setMode');
    expect(modes.at(-1)).toMatchObject({ initialSubset: { name: 'SubB', isPrivate: false } });
    panel.dispose();
  });

});

// S2-3: selection panels were never entered into the panel map (`if (!isSelection)`),
// which is why `disposeDimensionBrowserForServer` never found them on disconnect —
// along with the `Tm1Config` held in the closure and a live message listener.
// They need their OWN key per opening: several selection panels must still
// not push each other out.
describe('dimensionBrowser — disposeDimensionBrowserForServer', () => {
  function panelAt(i: number): any {
    return (vscode.window.createWebviewPanel as any).mock.results[i].value;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    (vscode.window.showWarningMessage as any) = vi.fn();
    (listDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D']);
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D']);
    initializeDimensionBrowser(vscode.Uri.file('/ext'));
  });

  it('disposes selection-mode panels of that server', async () => {
    await openDimensionBrowser('D', CONFIG, { mode: 'selection', multiSelect: false } as never);
    const panel = panelAt(0);
    const spy = vi.spyOn(panel, 'dispose');

    disposeDimensionBrowserForServer(CONFIG.serverUrl);

    expect(spy).toHaveBeenCalled();
  });

  it('keeps several selection panels of the same dimension open side by side', async () => {
    await openDimensionBrowser('D', CONFIG, { mode: 'selection', multiSelect: false } as never);
    await openDimensionBrowser('D', CONFIG, { mode: 'selection', multiSelect: false } as never);

    expect((vscode.window.createWebviewPanel as any).mock.calls.length).toBe(2);
    const first = panelAt(0);
    const second = panelAt(1);
    expect(second).not.toBe(first);

    const spies = [vi.spyOn(first, 'dispose'), vi.spyOn(second, 'dispose')];
    disposeDimensionBrowserForServer(CONFIG.serverUrl);
    for (const s of spies) { expect(s).toHaveBeenCalled(); }
  });

  it('disposes standalone panels and leaves other servers alone', async () => {
    await openDimensionBrowser('D', CONFIG);
    const mine = panelAt(0);
    await openDimensionBrowser('D', { ...CONFIG, serverUrl: 'http://other:1' } as never);
    const foreign = panelAt(1);

    const mineSpy = vi.spyOn(mine, 'dispose');
    const foreignSpy = vi.spyOn(foreign, 'dispose');
    disposeDimensionBrowserForServer(CONFIG.serverUrl);

    expect(mineSpy).toHaveBeenCalled();
    expect(foreignSpy).not.toHaveBeenCalled();
    foreign.dispose();
  });
});

// Two profiles may share a serverUrl (different users, or two v12 databases
// behind one gateway). Each must get its own panel and its own read guard —
// otherwise a reveal hands B's click to a panel that keeps writing as A.
describe('dimensionBrowser — two identities on the same URL', () => {
  const A = { ...CONFIG, username: 'alice' };
  const B = { ...CONFIG, username: 'bob' };

  beforeEach(() => {
    (listDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['DX']);
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockResolvedValue(['DX']);
    initializeDimensionBrowser(vscode.Uri.file('/ext'));
  });

  it('opens a separate panel per identity, and each panel works as its own identity', async () => {
    await openDimensionBrowser('DX', A);
    await openDimensionBrowser('DX', B);
    const panels = (vscode.window.createWebviewPanel as any).mock.results.map((r: any) => r.value);
    expect(panels).toHaveLength(2);
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockClear();
    panels[1].simulateMessage({ type: 'fetchHierarchies', dimName: 'DX' });
    await vi.waitFor(() => expect(listHierarchyNames).toHaveBeenCalled());
    expect((listHierarchyNames as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ username: 'bob' });
  });

  it("a complete read as B does not lift A's incomplete-read guard", async () => {
    const { noteSubsetRead, saveSubset } = await import('../commands/dimension/dimensionSubsetSave');
    noteSubsetRead(A as never, 'DX', 'DX', 'S', true, false);
    noteSubsetRead(B as never, 'DX', 'DX', 'S', true, true);
    (subsetExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getSubset as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, Name: 'S', Expression: null, Alias: null });
    (listSubsetElementNames as ReturnType<typeof vi.fn>).mockResolvedValue({ elements: ['E'], complete: true });
    (subsetElementCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    await expect(saveSubset('DX', 'DX', 'S', true, ['E'], true, A as never, null, 'all'))
      .rejects.toThrow(/not read completely/);
    expect(updateSubset).not.toHaveBeenCalled();
  });
});
