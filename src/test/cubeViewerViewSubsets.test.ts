import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * H3 — a context (title) pick on a saved view must not truncate it.
 *
 * The webview can only report the row members of the tuples it has LOADED (one
 * cell page = CELL_PAGE_ROWS = 10 000). Building the temp NativeView from those
 * shrank a 295k-row view to ~10k rows. `_fetchViewAxisSubsets` reads the view's
 * OWN axis subsets from the server instead, and `_refreshWithTempView` carries
 * registered / MDX subsets through BY REFERENCE, so no member list travels and
 * the axis keeps its full size.
 *
 * Since the refresh reads the grid through `ExecuteMDX`, the reference forms
 * travel as `TM1SUBSETTOSET` / the expression itself instead of as an OData
 * bind — same promise, different carrier. Only a PRIVATE subset has no MDX
 * form and still takes the temp-NativeView route.
 *
 * Follow-up review of that fix:
 *  • HIGH-1 — a PRIVATE view's subset must not be bound from the PUBLIC
 *    collection (silently wrong rows, or a 404 that kills the refresh).
 *  • HIGH-2 — the anonymous, expression-less fallback must be BOUNDED; an
 *    uncapped `$expand=Elements` on a 295k-member axis is a ~10 MB GET plus a
 *    ~25 MB POST. Over the cap the axis is reported as `oversized` so the caller
 *    can tell the user, instead of degrading silently.
 */

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

vi.mock('../tm1Rest/cubeApi', async (orig) => {
  const actual = await orig<typeof import('../tm1Rest/cubeApi')>();
  return { ...actual, probeViewKind: vi.fn(), deleteView: vi.fn(), createView: vi.fn(), updateView: vi.fn() };
});

vi.mock('../commands/cubeViewer/executeView', () => ({ _executeView: vi.fn() }));
vi.mock('../commands/cubeViewer/executeMdxInline', () => ({ _executeMdxInline: vi.fn() }));
vi.mock('../commands/cubeViewer/axisMeta', () => ({ _buildAxisMeta: vi.fn() }));
vi.mock('../commands/cubeViewer/cellsetState', () => ({
  dropPanelCellset: vi.fn(),
  _stashPageContext: vi.fn(),
}));

// Task 7b: `view.ts` now also sends the picklist maps along. Without this
// dummy the picklist path would run into the real network — `picklistApi` imports
// the transport DIRECTLY (`tm1Rest/client`), because the facade is forbidden to the deep
// layers, and a mock only on `tm1Client` does not take effect there: the test
// would end in timeouts instead of in a clear error (docs/architecture/import-rules.md, "Test mocks").
// `hasPicklistCube: false` = no control cube, the cheapest answer.
vi.mock('../commands/cubeViewer/picklistApi', () => ({
  hasPicklistCube: vi.fn().mockResolvedValue(false),
  fetchElementPicklists: vi.fn().mockResolvedValue({}),
  fetchRulePicklists: vi.fn().mockResolvedValue({}),
  fetchCellPicklist: vi.fn().mockResolvedValue(null),
  resolvePicklist: vi.fn().mockResolvedValue(null),
  invalidatePicklistResolutions: vi.fn(),
  disposePicklistCachesForServer: vi.fn(),
}));

import { apiRequest } from '../tm1Client';
import { createView, deleteView, probeViewKind, updateView } from '../tm1Rest/cubeApi';
import { _fetchViewAxisSubsets, VIEW_AXIS_ELEMENTS_MAX } from '../commands/cubeViewer/fetch';
import { _refreshWithTempView, _saveView, refreshCurrentLayout, clearViewAxisWarnings, _viewAxisBaseline } from '../commands/cubeViewer/view';

/** The refresh after a write is the webview's ordinary `refreshData` since
 *  review 2026-11-02 (C4); on the host it lands in `refreshCurrentLayout`. */
function refreshAfterWrite(panelKey: string, panel: unknown, msg: Record<string, any>): Promise<void> {
  return refreshCurrentLayout(
    panelKey, panel as never, 'Sales', msg.existingViewName ?? undefined, !!msg.existingViewIsPrivate,
    msg.rowDims, msg.colDims, msg.titleAssignments ?? {}, msg.dimSubsets ?? {}, !!msg.titleOverride,
    false, false, CONFIG as never, 1, true,
  );
}
import * as vscode from 'vscode';
import { _executeView } from '../commands/cubeViewer/executeView';
import { _executeMdxInline } from '../commands/cubeViewer/executeMdxInline';
import { _buildAxisMeta } from '../commands/cubeViewer/axisMeta';
import { _dimSelections, _panels, _tempViews } from '../commands/cubeViewer/state';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createView as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteView as unknown as ReturnType<typeof vi.fn>;
const mockKind = probeViewKind as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = updateView as unknown as ReturnType<typeof vi.fn>;
const mockExec = _executeView as unknown as ReturnType<typeof vi.fn>;
const mockExecMdx = _executeMdxInline as unknown as ReturnType<typeof vi.fn>;
const mockMeta = _buildAxisMeta as unknown as ReturnType<typeof vi.fn>;

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

function ok(payload: unknown) {
  return { statusCode: 200, body: JSON.stringify(payload) };
}

/** One `/Rows` or `/Columns` axis entry as TM1 returns it. */
function axisEntry(dim: string, subset: Record<string, unknown>) {
  return { Hierarchy: { Name: dim }, Subset: subset };
}

/** URLs of every axis read (the subset-visibility probes are filtered out). */
function axisUrls(): string[] {
  return mockApi.mock.calls
    .map(([, url]) => String(url))
    .filter((u) => /\/(Rows|Columns)\?/.test(u));
}

describe('_fetchViewAxisSubsets', () => {
  beforeEach(() => { mockApi.mockReset(); });

  it('takes a registered subset by reference and never expands its elements', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) { return ok({ value: [axisEntry('Region', { Name: 'AllRegions' })] }); }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never);

    expect(res).toEqual({
      subsets: {
        Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      oversized: [],
    });
    // Exactly two calls (Rows + Columns) and NO Elements expansion — expanding
    // is what loses scale on a 295k-member axis. A PUBLIC view can only
    // reference public subsets, so it also costs no visibility probe.
    expect(mockApi).toHaveBeenCalledTimes(2);
    for (const [, url] of mockApi.mock.calls) {
      expect(String(url)).not.toContain('Elements');
    }
  });

  it('carries an MDX subset through as an expression', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        return ok({ value: [axisEntry('Region', { Name: '', Expression: '{TM1SUBSETALL([Region])}' })] });
      }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never);

    expect(res?.subsets.Region).toEqual({ kind: 'expression', expression: '{TM1SUBSETALL([Region])}' });
    expect(mockApi).toHaveBeenCalledTimes(2);
  });

  it('re-reads only the axis whose subset is anonymous and expression-less, with elements expanded', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        return url.includes('Elements')
          ? ok({ value: [axisEntry('Region', { Name: '', Elements: [{ Name: 'North' }, { Name: 'South' }] })] })
          : ok({ value: [axisEntry('Region', { Name: '', Expression: '' })] });
      }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never);

    expect(res).toEqual({
      subsets: {
        Region: { kind: 'elements', names: ['North', 'South'] },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      oversized: [],
    });
    // 3 calls: Rows (cheap) + Columns (cheap) + Rows again WITH elements. The
    // Columns axis is referenceable, so it is never re-read.
    expect(mockApi).toHaveBeenCalledTimes(3);
    const elementCalls = mockApi.mock.calls.filter(([, url]) => String(url).includes('Elements'));
    expect(elementCalls).toHaveLength(1);
    expect(String(elementCalls[0][1])).toContain('/Rows');
  });

  // ── HIGH-2 — the expensive path must be bounded ────────────────────────────

  it('caps the Elements expansion with $top (HIGH-2: no unbounded 10 MB GET)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        return url.includes('Elements')
          ? ok({ value: [axisEntry('Region', { Name: '', Elements: [{ Name: 'North' }] })] })
          : ok({ value: [axisEntry('Region', { Name: '', Expression: '' })] });
      }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });

    await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never);

    const elementCall = mockApi.mock.calls.find(([, url]) => String(url).includes('Elements'));
    // MAX+1 so an over-cap axis is detectable instead of silently trimmed.
    expect(String(elementCall![1])).toContain(`$top=${VIEW_AXIS_ELEMENTS_MAX + 1}`);
  });

  it('reports an axis beyond the cap as oversized instead of shipping it', async () => {
    const tooMany = Array.from(
      { length: VIEW_AXIS_ELEMENTS_MAX + 1 }, (_v, i) => ({ Name: `E${i}` }),
    );
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        return url.includes('Elements')
          ? ok({ value: [axisEntry('Region', { Name: '', Elements: tooMany })] })
          : ok({ value: [axisEntry('Region', { Name: '', Expression: '' })] });
      }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never);

    // No entry at all: a ~25 MB createView POST is worse than the caller's
    // truncated baseline — but the caller is TOLD, so the user hears about it.
    expect(res?.subsets.Region).toBeUndefined();
    expect(res?.oversized).toEqual(['Region']);
    expect(res?.subsets.Month).toEqual({ kind: 'namedSubset', name: 'FY26', isPrivate: false });
  });

  it('reports an axis whose elements come back empty as oversized (never silently dropped)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        return url.includes('Elements')
          ? ok({ value: [axisEntry('Region', { Name: '', Elements: [] })] })
          : ok({ value: [axisEntry('Region', { Name: '', Expression: '' })] });
      }
      return ok({ value: [] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never);
    expect(res?.oversized).toEqual(['Region']);
  });

  // ── HIGH-1 — private vs. public subset collection ──────────────────────────

  it('uses the PrivateViews collection for a private view', async () => {
    mockApi.mockResolvedValue(ok({ value: [] }));
    await _fetchViewAxisSubsets('Sales', 'Mine', true, CONFIG as never);
    expect(axisUrls().length).toBeGreaterThan(0);
    for (const url of axisUrls()) {
      expect(url).toContain("/PrivateViews('Mine')");
    }
  });

  it('binds a private view\'s PUBLIC subset publicly (no private twin exists)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/PrivateSubsets(')) { return { statusCode: 404, body: '{}' }; }
      if (url.includes('/Subsets(')) { return ok({ Name: 'AllRegions' }); }
      if (url.includes('/Rows')) { return ok({ value: [axisEntry('Region', { Name: 'AllRegions' })] }); }
      return ok({ value: [] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'Mine', true, CONFIG as never);
    expect(res?.subsets.Region).toEqual({ kind: 'namedSubset', name: 'AllRegions', isPrivate: false });
  });

  it('does NOT bind a private-origin subset from the public collection for a PUBLIC target', async () => {
    // The private subset "MyRegions" exists AND a public one of that name does
    // too — the old code bound the public one and showed the wrong rows.
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/PrivateSubsets(')) { return ok({ Name: 'MyRegions' }); }
      if (url.includes('/Subsets(')) { return ok({ Name: 'MyRegions' }); }
      if (url.includes('/Rows')) {
        return url.includes('Elements')
          ? ok({ value: [axisEntry('Region', { Name: 'MyRegions', Elements: [{ Name: 'North' }] })] })
          : ok({ value: [axisEntry('Region', { Name: 'MyRegions' })] });
      }
      return ok({ value: [] });
    });

    const res = await _fetchViewAxisSubsets('Sales', 'Mine', true, CONFIG as never);

    // Falls back to the (capped) element copy — never a public bind.
    expect(res?.subsets.Region).toEqual({ kind: 'elements', names: ['North'] });
    expect(JSON.stringify(res)).not.toContain('namedSubset');
  });

  it('keeps a private-origin subset BY REFERENCE when the target view is private too', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/PrivateSubsets(')) { return ok({ Name: 'MyRegions' }); }
      if (url.includes('/Subsets(')) { return { statusCode: 404, body: '{}' }; }
      if (url.includes('/Rows')) { return ok({ value: [axisEntry('Region', { Name: 'MyRegions' })] }); }
      return ok({ value: [] });
    });

    const res = await _fetchViewAxisSubsets(
      'Sales', 'Mine', true, CONFIG as never, { targetIsPrivate: true },
    );
    expect(res?.subsets.Region).toEqual({ kind: 'namedSubset', name: 'MyRegions', isPrivate: true });
    // No element expansion needed — the reference form survives.
    expect(axisUrls().some((u) => u.includes('Elements'))).toBe(false);
  });

  it('returns null when an axis cannot be read (caller falls back)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) =>
      (url.includes('/Rows') ? { statusCode: 400, body: '{}' } : ok({ value: [] })));
    expect(await _fetchViewAxisSubsets('Sales', 'BigView', false, CONFIG as never)).toBeNull();
  });
});

describe('_refreshWithTempView — reference subsets', () => {
  const panel = { webview: { postMessage: vi.fn() } } as never;

  const MATRIX = {
    rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [], colTuples: [], values: {}, cellFlags: {},
    numCols: 12, totalRows: 295_000, loadedRows: 10_000, paged: true,
  };

  beforeEach(() => {
    (panel as any).webview.postMessage.mockReset();
    _panels.set('panel1', panel); _tempViews.clear();
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockExec.mockReset().mockResolvedValue({ ...MATRIX });
    mockExecMdx.mockReset().mockResolvedValue({ ...MATRIX });
    mockMeta.mockReset().mockResolvedValue({
      levels: [], parents: [], allParents: [], levelMaps: [],
    });
  });

  /** The MDX the refresh read the grid from. */
  function mdxOf(): string {
    return mockExecMdx.mock.calls[0][0] as string;
  }
  function bodyOf(): Record<string, any> {
    return mockCreate.mock.calls[0][2] as Record<string, any>;
  }

  it('resolves a registered subset by reference — no member list travels', async () => {
    await _refreshWithTempView(
      'panel1', panel, 'Sales', ['Region'], ['Month'], { Year: '2026' },
      {
        Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, CONFIG as never, 1,
    );

    // No temp view at all — the layout is read straight through ExecuteMDX.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mdxOf()).toBe(
      'SELECT {TM1SUBSETTOSET([Month].[Month], "FY26")} ON 0, '
      + '{TM1SUBSETTOSET([Region].[Region], "AllRegions")} ON 1 '
      + 'FROM [Sales] WHERE ([Year].[Year].[2026])',
    );
  });

  it('carries an MDX subset expression through verbatim', async () => {
    await _refreshWithTempView(
      'panel1', panel, 'Sales', ['Region'], ['Month'], {},
      {
        Region: { kind: 'expression', expression: '{TM1SUBSETALL([Region])}' },
        Month: { kind: 'elements', names: ['Jan'] },
      },
      false, false, CONFIG as never, 1,
    );
    expect(mdxOf()).toBe(
      'SELECT {[Month].[Month].[Jan]} ON 0, {TM1SUBSETALL([Region])} ON 1 FROM [Sales]',
    );
  });

  it('keeps the executed grid at its full row count (no client-side truncation)', async () => {
    await _refreshWithTempView(
      'panel1', panel, 'Sales', ['Region'], ['Month'], {},
      {
        Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, CONFIG as never, 1,
    );
    const sent = (panel as any).webview.postMessage.mock.calls.at(-1)[0];
    expect(sent.type).toBe('cellData');
    expect(sent.matrix.totalRows).toBe(295_000);
    expect(sent.matrix.loadedRows).toBe(10_000);
  });

  it('falls back to the temp NativeView for a PRIVATE subset — MDX cannot address one', async () => {
    await _refreshWithTempView(
      'panel1', panel, 'Sales', ['Region'], ['Month'], { Year: '2026' },
      {
        Region: { kind: 'namedSubset', name: 'MyRegions', isPrivate: true },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, CONFIG as never, 1,
    );

    expect(mockExecMdx).not.toHaveBeenCalled();
    const body = bodyOf();
    expect(body.Rows[0]['Subset@odata.bind'])
      .toBe("Dimensions('Region')/Hierarchies('Region')/PrivateSubsets('MyRegions')");
    expect(body.Columns[0]['Subset@odata.bind'])
      .toBe("Dimensions('Month')/Hierarchies('Month')/Subsets('FY26')");
    // Even on the fallback the axes stay by reference — nothing is enumerated.
    expect(JSON.stringify({ Rows: body.Rows, Columns: body.Columns }))
      .not.toContain('Elements@odata.bind');
    expect(body.Titles).toEqual([expect.objectContaining({
      'Selected@odata.bind': "Dimensions('Year')/Hierarchies('Year')/Elements('2026')",
    })]);
  });
  it('deletes the temp view again when the panel closed while it was created', async () => {
    // Review 2026-10-02: the dispose cleanup had already run, so the view
    // registered afterwards stayed on the server as }TmpView_VSCode_<ts>.
    mockCreate.mockImplementation(async () => { _panels.delete('panel1'); });
    await _refreshWithTempView(
      'panel1', panel, 'Sales', ['Region'], ['Month'], {},
      {
        Region: { kind: 'namedSubset', name: 'MyRegions', isPrivate: true },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, CONFIG as never, 1,
    );
    expect(mockDelete).toHaveBeenCalledWith(CONFIG, 'Sales', bodyOf().Name, false, 10000);
    expect(_tempViews.has('panel1')).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe('_saveView — reference subsets (MED-2 / HIGH-1 / alias LOW)', () => {
  beforeEach(() => {
    mockApi.mockReset().mockResolvedValue(ok({ value: [] }));
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockUpdate.mockReset().mockResolvedValue(undefined);
    // No view of that name yet → create path, where the full body travels.
    mockKind.mockReset().mockResolvedValue(null);
  });

  function bodyOf(): Record<string, any> {
    return mockCreate.mock.calls[0][2] as Record<string, any>;
  }

  it('persists a registered subset by reference (Save must not shrink a 295k view)', async () => {
    await _saveView(
      'Sales', 'Copy', false, false, ['Region'], ['Month'], {},
      {
        Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, {}, CONFIG as never,
    );
    const body = bodyOf();
    expect(body.Rows[0]['Subset@odata.bind'])
      .toBe("Dimensions('Region')/Hierarchies('Region')/Subsets('AllRegions')");
    expect(JSON.stringify({ Rows: body.Rows, Columns: body.Columns }))
      .not.toContain('Elements@odata.bind');
  });

  // "All" in the Dimension Browser (click test 2026-08-12). As a member list
  // the axis would be silently capped: `_fetchDimElements` fetches at most 500 names.
  it('persists an explicit whole-dimension axis as an expression, not as a member list', async () => {
    await _saveView(
      'Sales', 'Copy', false, false, ['Region'], ['Month'], {},
      {
        Region: { kind: 'all' },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, {}, CONFIG as never,
    );
    const body = bodyOf();
    expect(body.Rows[0].Subset).toEqual({
      '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
      'Hierarchy@odata.bind': "Dimensions('Region')/Hierarchies('Region')",
      Expression: '{TM1SUBSETALL([Region].[Region])}',
    });
    expect(JSON.stringify(body.Rows)).not.toContain('Elements@odata.bind');
  });

  it('binds a private-origin subset from PrivateSubsets, not Subsets (HIGH-1)', async () => {
    await _saveView(
      'Sales', 'MyCopy', true, false, ['Region'], ['Month'], {},
      {
        Region: { kind: 'namedSubset', name: 'MyRegions', isPrivate: true },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, {}, CONFIG as never,
    );
    const body = bodyOf();
    expect(body.Rows[0]['Subset@odata.bind'])
      .toBe("Dimensions('Region')/Hierarchies('Region')/PrivateSubsets('MyRegions')");
    expect(body.Columns[0]['Subset@odata.bind'])
      .toBe("Dimensions('Month')/Hierarchies('Month')/Subsets('FY26')");
  });

  it('keeps the alias on a referenced public subset via TM1SUBSETTOSET (LOW)', async () => {
    await _saveView(
      'Sales', 'Copy', false, false, ['Region'], ['Month'], {},
      {
        Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, { Region: 'Kurzname' }, CONFIG as never,
    );
    const body = bodyOf();
    // A bound subset has no per-view Alias slot, so the reference is expressed
    // as MDX instead — still symbolic (no member list), but Alias-capable.
    expect(body.Rows[0].Subset).toEqual({
      '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
      'Hierarchy@odata.bind': "Dimensions('Region')/Hierarchies('Region')",
      Expression: '{TM1SUBSETTOSET([Region].[Region], "AllRegions")}',
      Alias: 'Kurzname',
    });
    expect(body.Rows[0]['Subset@odata.bind']).toBeUndefined();
    // Aliasless dims keep the cheap bind.
    expect(body.Columns[0]['Subset@odata.bind'])
      .toBe("Dimensions('Month')/Hierarchies('Month')/Subsets('FY26')");
  });
});

/**
 * LOW-1 — every `…@odata.bind` value is a RESOURCE PATH, so it needs
 * quote-doubling AND percent-encoding (`encodeODataKey`), exactly like
 * `cubeWriteApi#buildTupleRefs` and `cellTraceTypes#buildTupleBind`. TM1 names
 * legally contain `/`, `#`, `?` and spaces; unencoded they split the path, cut
 * it off at a fragment or start a query, so the temp/saved view silently binds
 * the wrong object (or 404s). MDX (`Expression`) is not a path and keeps its
 * own escaping.
 */
describe('_saveView — @odata.bind path encoding (LOW-1)', () => {
  beforeEach(() => {
    mockApi.mockReset().mockResolvedValue(ok({ value: [] }));
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockUpdate.mockReset().mockResolvedValue(undefined);
    // No view of that name yet → create path, where the full body travels.
    mockKind.mockReset().mockResolvedValue(null);
  });

  function bodyOf(): Record<string, any> {
    return mockCreate.mock.calls[0][2] as Record<string, any>;
  }

  it('percent-encodes dim, hierarchy and subset names in a Subset@odata.bind', async () => {
    await _saveView(
      'Sales', 'Copy', false, false, ['A/B'], ['C#D'], {},
      {
        'A/B': { kind: 'namedSubset', name: 'S/1', isPrivate: false },
        'C#D': { kind: 'namedSubset', name: "O'Brien ?", isPrivate: true },
      },
      false, false, {}, CONFIG as never,
    );
    const body = bodyOf();
    expect(body.Rows[0]['Hierarchy@odata.bind'])
      .toBe("Dimensions('A%2FB')/Hierarchies('A%2FB')");
    expect(body.Rows[0]['Subset@odata.bind'])
      .toBe("Dimensions('A%2FB')/Hierarchies('A%2FB')/Subsets('S%2F1')");
    // `'` stays doubled (OData literal escape) and is NOT percent-encoded;
    // `?` and the space are.
    expect(body.Columns[0]['Subset@odata.bind'])
      .toBe("Dimensions('C%23D')/Hierarchies('C%23D')/PrivateSubsets('O''Brien%20%3F')");
  });

  it('percent-encodes element names in Elements@odata.bind and Selected@odata.bind', async () => {
    await _saveView(
      'Sales', 'Copy', false, false, ['Region'], ['Month'], { 'Y/Z': 'FY 26#1' },
      {
        Region: { kind: 'elements', names: ['N/S', 'E?W', "O'Brien"] },
        Month: { kind: 'consolidation', name: 'Q1 #1' },
      },
      false, false, {}, CONFIG as never,
    );
    const body = bodyOf();
    expect(body.Rows[0].Subset['Elements@odata.bind']).toEqual([
      "Dimensions('Region')/Hierarchies('Region')/Elements('N%2FS')",
      "Dimensions('Region')/Hierarchies('Region')/Elements('E%3FW')",
      "Dimensions('Region')/Hierarchies('Region')/Elements('O''Brien')",
    ]);
    expect(body.Columns[0].Subset['Elements@odata.bind'])
      .toEqual(["Dimensions('Month')/Hierarchies('Month')/Elements('Q1%20%231')"]);
    expect(body.Titles[0]['Selected@odata.bind'])
      .toBe("Dimensions('Y%2FZ')/Hierarchies('Y%2FZ')/Elements('FY%2026%231')");
  });

  it('leaves the MDX Expression unencoded — it is a literal, not a path', async () => {
    await _saveView(
      'Sales', 'Copy', false, false, ['A/B'], ['Month'], {},
      {
        'A/B': { kind: 'namedSubset', name: 'S/1', isPrivate: false },
        Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
      },
      false, false, { 'A/B': 'Kurzname' }, CONFIG as never,
    );
    const body = bodyOf();
    expect(body.Rows[0].Subset.Expression)
      .toBe('{TM1SUBSETTOSET([A/B].[A/B], "S/1")}');
    // The bind next to it IS a path and stays encoded.
    expect(body.Rows[0].Subset['Hierarchy@odata.bind'])
      .toBe("Dimensions('A%2FB')/Hierarchies('A%2FB')");
  });
});

// TM1 knows no transactions: once a DELETE succeeded, a failing POST cannot be
// rolled back — the compensating write fails for the same reason. So the fix is
// to not open that window at all where TM1 allows it (PATCH, verified live on
// 11.8.02900.8), and to state the loss plainly where it does not (type change).
describe('_saveView — overwrite must not open a destructive window', () => {
  beforeEach(() => {
    mockApi.mockReset().mockResolvedValue(ok({ value: [] }));
    mockCreate.mockReset().mockResolvedValue(undefined);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockUpdate.mockReset().mockResolvedValue(undefined);
  });

  // Registered subsets on both axes: keeps the test on the write path and out of
  // the element fetch that a `kind:'all'` selection would trigger.
  const save = (overwrite: boolean) => _saveView(
    'Sales', 'Copy', false, overwrite, ['Region'], ['Month'], {},
    {
      Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false },
      Month: { kind: 'namedSubset', name: 'FY26', isPrivate: false },
    },
    false, false, {}, CONFIG as never,
  );

  it('PATCHes an existing NativeView instead of deleting it', async () => {
    mockKind.mockResolvedValue('native');
    await save(true);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('sends a complete axis set in the PATCH, without Name and @odata.type', async () => {
    mockKind.mockResolvedValue('native');
    await save(true);
    const patch = mockUpdate.mock.calls[0][3] as Record<string, any>;
    // A PATCH replaces named axes wholesale — an omitted axis would survive
    // stale, an omitted Subset.Alias would be dropped.
    expect(patch.Rows).toBeDefined();
    expect(patch.Columns).toBeDefined();
    expect(patch.Titles).toBeDefined();
    expect(patch.SuppressEmptyRows).toBe(false);
    expect(patch.Name).toBeUndefined();
    expect(patch['@odata.type']).toBeUndefined();
  });

  it('falls back to DELETE+POST when the existing view is an MDXView', async () => {
    mockKind.mockResolvedValue('mdx');
    await save(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('routes an unknown existing type to the safe DELETE+POST path', async () => {
    mockKind.mockResolvedValue('other');
    await save(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });

  it('says the original is gone when the recreate fails after the delete', async () => {
    mockKind.mockResolvedValue('mdx');
    mockCreate.mockRejectedValue(new Error('HTTP 500 boom'));
    await expect(save(true)).rejects.toThrow(/no longer on the server/);
  });

  it('POSTs plainly when nothing exists yet', async () => {
    mockKind.mockResolvedValue(null);
    await save(false);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

/**
 * Task 8 — click test 2026-08-12: a C-element added through the dimension
 * browser vanished the moment a value was written. Cause: `_refreshAfterSpread`
 * re-read the SAVED view whenever one was open, discarding `_dimSelections` —
 * the same in-memory working state `refreshData` already knows to prefer over
 * a saved view once the user has set an explicit dim filter. The two paths are
 * unified through `refreshCurrentLayout`; these tests exercise `view.ts`
 * directly (unmocked) because `refreshCurrentLayout` calls
 * `_readExistingView` and `_refreshWithTempView` as SAME-MODULE local
 * references — mocking `'../commands/cubeViewer/view'` from outside (as
 * `cubeViewerMessaging.test.ts` does for the dispatch-table tests) cannot
 * intercept those calls, so the branching itself has to be proven here.
 */
describe('refresh after a write — the working state beats the saved view (Task 8)', () => {
  const PANEL_KEY = 'panel1';
  const panel = { webview: { postMessage: vi.fn() } } as any;

  const MATRIX = {
    rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [], colTuples: [], values: {}, cellFlags: {},
    numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
  };

  beforeEach(() => {
    (panel as any).webview.postMessage.mockReset();
    mockExec.mockReset().mockResolvedValue({ ...MATRIX });
    mockExecMdx.mockReset().mockResolvedValue({ ...MATRIX });
    mockMeta.mockReset().mockResolvedValue({
      levels: [], parents: [], allParents: [], levelMaps: [],
    });
    _dimSelections.clear();
  });

  // The refresh does not look at `msg.type` — the two payload
  // shapes below stand in for the three real callers (`spread`, `spreadBulk`,
  // `cellEditBulk`); the brief explicitly asks for the `spread` shape too, so
  // the rule is proven on more than the bulk-paste field names.
  const BULK_MSG = {
    type: 'cellEditBulk',
    dimensions: ['Region', 'Month'],
    targets: [{ ri: 0, ci: 0, coordinates: ['A', 'Jan'], value: 5 }],
    rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    existingViewName: 'gespeichert', existingViewIsPrivate: false,
    dimSubsets: { Region: ['A', 'B'], Month: ['Jan'] },
    titleOverride: false,
  };

  const SPREAD_MSG = {
    type: 'spread',
    ri: 0, ci: 0, method: 'value', value: 5,
    coordinates: ['A', 'Jan'], dimensions: ['Region', 'Month'],
    rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    existingViewName: 'gespeichert', existingViewIsPrivate: false,
    dimSubsets: { Region: ['A', 'B'], Month: ['Jan'] },
    titleOverride: false,
  };

  it.each([
    ['cellEditBulk', BULK_MSG],
    ['spread', SPREAD_MSG],
  ])('%s: a just-added element is kept after writing', async (_label, msg) => {
    // The user added "C" to the row dim via the Dimension Browser.
    _dimSelections.set(PANEL_KEY, { Region: { kind: 'elements', names: ['A', 'B', 'C'] } });

    await refreshAfterWrite(PANEL_KEY, panel, { ...msg });

    // The working state wins: temp refresh (here via MDX, since both axes
    // have an 'elements' selection), NOT re-reading the saved view.
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockExecMdx).toHaveBeenCalledTimes(1);
    expect(mockExecMdx.mock.calls[0][0]).toContain('.[C]');
  });

  it.each([
    ['cellEditBulk', BULK_MSG],
    ['spread', SPREAD_MSG],
  ])('%s: without a user selection it stays with reading the saved view', async (_label, msg) => {
    // No `_dimSelections` set — no explicit user selection.
    await refreshAfterWrite(PANEL_KEY, panel, { ...msg });

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][1]).toBe('gespeichert');
    expect(mockExecMdx).not.toHaveBeenCalled();
  });

  it.each([
    ['cellEditBulk', BULK_MSG],
    ['spread', SPREAD_MSG],
  ])('%s: after a pivot (existingViewName null) the saved view is NOT re-read', async (_label, msg) => {
    // Pivot swapped the axes; the webview released the view binding.
    const pivoted = { ...msg, rowDims: ['Month'], colDims: ['Region'], existingViewName: null };
    await refreshAfterWrite(PANEL_KEY, panel, pivoted);

    expect(mockExec).not.toHaveBeenCalled();
    expect(mockExecMdx).toHaveBeenCalledTimes(1);
  });
});

// The refresh after a write shares `refreshCurrentLayout` with `refreshData`
// (Task 8) — the titleOverride branch (H3 baseline merge, MED-1/HIGH-2
// degradation warnings) is the SAME code either caller reaches it through,
// so proving it once here through the refresh after a write covers both.
describe('refresh after a write — titleOverride reuses the shared baseline merge (H3/MED-1/HIGH-2)', () => {
  const PANEL_KEY = 'panel1';
  const panel = { webview: { postMessage: vi.fn() } } as any;

  const MATRIX = {
    rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [], colTuples: [], values: {}, cellFlags: {},
    numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
  };

  const MSG = {
    type: 'cellEditBulk',
    rowDims: ['Region'], colDims: ['Month'], titleAssignments: { Year: '2026' },
    existingViewName: 'gespeichert', existingViewIsPrivate: false,
    dimSubsets: { Region: ['North', 'South'], Month: ['Jan'] },
    titleOverride: true,
  };

  // `_fetchViewAxisSubsets` is NOT mocked in this file (see the top describe
  // block, which exercises the real function) — so these drive it through its
  // real REST calls via `mockApi`, exactly like that block does.
  beforeEach(() => {
    (panel as any).webview.postMessage.mockReset();
    mockExec.mockReset().mockResolvedValue({ ...MATRIX });
    mockExecMdx.mockReset().mockResolvedValue({ ...MATRIX });
    mockMeta.mockReset().mockResolvedValue({
      levels: [], parents: [], allParents: [], levelMaps: [],
    });
    mockApi.mockReset();
    (vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
    _dimSelections.clear();
    clearViewAxisWarnings(PANEL_KEY);
  });

  it('titleOverride: view-own axis subsets win over the loaded-tuple baseline (H3)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) { return ok({ value: [axisEntry('Region', { Name: 'AllRegions' })] }); }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });
    await refreshAfterWrite(PANEL_KEY, panel, { ...MSG });

    // Re-executing the saved view would snap back to its title member and
    // discard the context pick — the temp path must run instead.
    expect(mockExec).not.toHaveBeenCalled();
    expect(axisUrls().some((u) => u.includes('gespeichert'))).toBe(true);
    // Region came from the VIEW (by reference), not from msg.dimSubsets' element list.
    expect(mockExecMdx.mock.calls[0][0]).toContain('TM1SUBSETTOSET([Region].[Region]');
    expect(mockExecMdx.mock.calls[0][0]).not.toContain('.[North]');
  });

  it('titleOverride: an explicit dim selection still wins over the view\'s own axis (dimSel > viewSel)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) { return ok({ value: [axisEntry('Region', { Name: 'AllRegions' })] }); }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });
    _dimSelections.set(PANEL_KEY, { Region: { kind: 'elements', names: ['C'] } });
    await refreshAfterWrite(PANEL_KEY, panel, { ...MSG });

    // A user dim filter means `refreshCurrentLayout` never even asks the view
    // for its own axes — the branch is `viewName && !hasUserDimFilters && ...`.
    expect(mockApi).not.toHaveBeenCalled();
    expect(mockExecMdx.mock.calls[0][0]).toContain('.[C]');
  });

  it('titleOverride: an unreadable axis degrades to the client baseline and warns once (MED-1)', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) { return { statusCode: 400, body: '{}' }; }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });
    const warn = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;

    await refreshAfterWrite(PANEL_KEY, panel, { ...MSG });
    await refreshAfterWrite(PANEL_KEY, panel, { ...MSG });

    expect(warn).toHaveBeenCalledTimes(1); // warn-once dedup per panel/view/reason
    expect(String(warn.mock.calls[0][0])).toContain('gespeichert');
    // Degrades to the loaded-tuple baseline instead of failing the write's refresh.
    expect(mockExecMdx.mock.calls[0][0]).toContain('.[North]');
    expect(mockExecMdx.mock.calls[0][0]).toContain('.[South]');
  });

  it('titleOverride: an oversized axis is warned about and left to the baseline (HIGH-2/MED-1)', async () => {
    const tooMany = Array.from(
      { length: VIEW_AXIS_ELEMENTS_MAX + 1 }, (_v, i) => ({ Name: `E${i}` }),
    );
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        return url.includes('Elements')
          ? ok({ value: [axisEntry('Region', { Name: '', Elements: tooMany })] })
          : ok({ value: [axisEntry('Region', { Name: '', Expression: '' })] });
      }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });
    const warn = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;

    await refreshAfterWrite(PANEL_KEY, panel, { ...MSG });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Region');
    const mdx = mockExecMdx.mock.calls[0][0];
    // Region keeps the (truncated) client baseline — but the user was told —
    // while Month picks up the view's own subset by reference.
    expect(mdx).toContain('.[North]');
    expect(mdx).toContain('TM1SUBSETTOSET([Month].[Month]');
  });
});

/**
 * Fix Round 1, FINDING 1: the rewrite that unified `refreshData` and
 * `_refreshAfterSpread` into `refreshCurrentLayout` deleted the tests for two
 * `_viewAxisBaseline` branches along with the old duplicated decision logic.
 * Both are still live code and had nothing left guarding them.
 */
describe('_viewAxisBaseline — the two branches only it exercises (Task 8, FINDING 1)', () => {
  const PANEL_KEY = 'panel-axis-baseline';

  beforeEach(() => {
    mockApi.mockReset();
    (vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
    clearViewAxisWarnings(PANEL_KEY);
  });

  it('a rejected axis read (network/HTTP error, not just a non-2xx body) degrades to the client baseline instead of throwing', async () => {
    mockApi.mockRejectedValue(new Error('HTTP 400'));
    const warn = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;

    const res = await _viewAxisBaseline(
      PANEL_KEY, 'Sales', 'BigView', false, false, ['Region'], ['Month'], CONFIG as never,
    );

    // Caller gets an empty baseline back, never a rejected promise.
    expect(res).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('BigView');
  });

  it('drops a subset for a dimension the caller no longer has on an axis', async () => {
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (url.includes('/Rows')) {
        // The saved view still carries a subset for "Extra" — e.g. the user
        // pivoted it off the axis onto a title since the view was last saved.
        return ok({ value: [
          axisEntry('Region', { Name: 'AllRegions' }),
          axisEntry('Extra', { Name: 'AllExtras' }),
        ] });
      }
      return ok({ value: [axisEntry('Month', { Name: 'FY26' })] });
    });

    const res = await _viewAxisBaseline(
      PANEL_KEY, 'Sales', 'BigView', false, false, ['Region'], ['Month'], CONFIG as never,
    );

    expect(res.Region).toEqual({ kind: 'namedSubset', name: 'AllRegions', isPrivate: false });
    expect(res.Month).toEqual({ kind: 'namedSubset', name: 'FY26', isPrivate: false });
    expect(res.Extra).toBeUndefined();
  });
});

/**
 * Fix Round 1, FINDING 3 (declared, not accidental): a write WITHOUT a saved
 * view now follows the same baseline rule as an ordinary refresh — a dim with
 * no explicit `dimSel` no longer falls back to `TM1SUBSETALL(...)` (the whole
 * dimension); it uses `dimSubsets` (the loaded tuples) instead, same as
 * `refreshData`. On a paged grid that means the post-write refresh comes back
 * with only the rows already loaded, not the full dimension. Consistent with
 * `refreshData` — that consistency was the whole point of the extraction —
 * so pinned here rather than left to be rediscovered as a regression.
 */
describe('refresh after a write — write without a saved view uses the baseline, not TM1SUBSETALL (Task 8, FINDING 3)', () => {
  const PANEL_KEY = 'panel-no-view';
  const panel = { webview: { postMessage: vi.fn() } } as any;

  const MATRIX = {
    rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [], colTuples: [], values: {}, cellFlags: {},
    numCols: 1, totalRows: 1, loadedRows: 1, paged: true,
  };

  beforeEach(() => {
    (panel as any).webview.postMessage.mockReset();
    mockExec.mockReset().mockResolvedValue({ ...MATRIX });
    mockExecMdx.mockReset().mockResolvedValue({ ...MATRIX });
    mockMeta.mockReset().mockResolvedValue({ levels: [], parents: [], allParents: [], levelMaps: [] });
    mockApi.mockReset();
    _dimSelections.clear();
    clearViewAxisWarnings(PANEL_KEY);
  });

  it('uses the loaded-tuple baseline for an unfiltered dim on a paged grid, not the full dimension', async () => {
    const msg = {
      type: 'cellEditBulk',
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
      existingViewName: undefined, existingViewIsPrivate: false,
      // Region has no explicit dimSel — only the paged/loaded tuples via dimSubsets.
      dimSubsets: { Region: ['North', 'South'], Month: ['Jan'] },
      titleOverride: false,
    };

    await refreshAfterWrite(PANEL_KEY, panel, msg);

    expect(mockApi).not.toHaveBeenCalled(); // no saved view to read axes from
    expect(mockExecMdx).toHaveBeenCalledTimes(1);
    const mdx = mockExecMdx.mock.calls[0][0] as string;
    expect(mdx).toContain('.[North]');
    expect(mdx).toContain('.[South]');
    expect(mdx).not.toContain('TM1SUBSETALL([Region]');
  });
});

