import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveMdxSaveTarget } from '../commands/cubeViewer/mdxSaveTargetPure';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn() }));

vi.mock('../tm1Rest/cubeApi', async (orig) => {
  const actual = await orig<typeof import('../tm1Rest/cubeApi')>();
  return { ...actual, probeViewKind: vi.fn(), deleteView: vi.fn(), createView: vi.fn(), updateView: vi.fn() };
});

import { apiRequest } from '../tm1Rest/client';
import { apiRequest as apiRequestFacade } from '../tm1Client';
import { getCubeViews, probeViewKind, deleteView, createView, updateView } from '../tm1Rest/cubeApi';
import { mdxViewLabel } from '../providers/treeViewLabelPure';
import { saveMdxView } from '../commands/cubeViewer/view';
import { _fetchViewAxisConfig } from '../commands/cubeViewer/fetch';
import { mdxMayLoseContent } from '../webviewClient/cubeViewerMonaco/mdxLossPure';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const mockKind = probeViewKind as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteView as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createView as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = updateView as unknown as ReturnType<typeof vi.fn>;

describe('getCubeViews', () => {
  beforeEach(() => mockApi.mockReset());

  it('marks MDXView entries via @odata.type', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ value: [
        { Name: 'NativeA', '@odata.type': '#ibm.tm1.api.v1.NativeView' },
        { Name: 'MdxB', '@odata.type': '#ibm.tm1.api.v1.MDXView' },
      ] }),
    });
    const res = await getCubeViews(undefined as never, 'Sales', false);
    expect(res).toEqual([
      { name: 'NativeA', isPrivate: false, isMdx: false },
      { name: 'MdxB', isPrivate: false, isMdx: true },
    ]);
  });

  it('falls back to native when @odata.type absent', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Legacy' }] }) });
    const res = await getCubeViews(undefined as never, 'Sales', true);
    expect(res).toEqual([{ name: 'Legacy', isPrivate: true, isMdx: false }]);
  });
});

describe('mdxViewLabel', () => {
  it('appends {} suffix to MDX view labels', () => {
    const native = mdxViewLabel('PnL', false);
    const mdx = mdxViewLabel('Cube_View', true);
    expect(native).toBe('PnL');
    expect(mdx).toBe('Cube_View {}');
  });
});

describe('saveMdxView', () => {
  beforeEach(() => {
    mockKind.mockReset(); mockDelete.mockReset(); mockCreate.mockReset(); mockUpdate.mockReset();
  });

  it('creates a new MDXView with @odata.type body', async () => {
    mockKind.mockResolvedValue(null);
    mockCreate.mockResolvedValue(undefined);
    await saveMdxView('Sales', 'NewMdx', 'SELECT {} ON 0, {} ON 1 FROM [Sales]', false, false, undefined as never);
    expect(mockDelete).not.toHaveBeenCalled();
    const body = mockCreate.mock.calls[0][2];
    expect(body['@odata.type']).toBe('#ibm.tm1.api.v1.MDXView');
    expect(body.Name).toBe('NewMdx');
    expect(body.MDX).toContain('FROM [Sales]');
  });

  it('throws when exists and overwrite=false', async () => {
    mockKind.mockResolvedValue('mdx');
    await expect(saveMdxView('Sales', 'Dup', 'X', false, false, undefined as never)).rejects.toThrow(/already exists/);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Overwriting an MDXView with an MDXView must never delete first: TM1 has no
  // transactions, so a failed POST after a successful DELETE loses the view.
  it('PATCHes on same-type overwrite and never deletes', async () => {
    mockKind.mockResolvedValue('mdx');
    mockUpdate.mockResolvedValue(undefined);
    const msg = await saveMdxView('Sales', 'Old', 'X', true, true, undefined as never);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(msg).toMatch(/overwritten/);
  });

  it('strips Name and @odata.type from the PATCH body', async () => {
    mockKind.mockResolvedValue('mdx');
    mockUpdate.mockResolvedValue(undefined);
    await saveMdxView('Sales', 'Old', 'SELECT 1', false, true, undefined as never);
    const patch = mockUpdate.mock.calls[0][3];
    expect(patch.MDX).toBe('SELECT 1');
    expect(patch.Name).toBeUndefined();
    expect(patch['@odata.type']).toBeUndefined();
  });

  // PATCH cannot convert a NativeView into an MDXView (live 11.8 answers 200 and
  // silently keeps the old type), so a type change must still DELETE+POST.
  it('falls back to DELETE+POST when the existing view is a NativeView', async () => {
    mockKind.mockResolvedValue('native');
    mockDelete.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue(undefined);
    await saveMdxView('Sales', 'Old', 'X', false, true, undefined as never);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports the lost original when the recreate fails after the delete', async () => {
    mockKind.mockResolvedValue('native');
    mockDelete.mockResolvedValue(undefined);
    mockCreate.mockRejectedValue(new Error('HTTP 500 boom'));
    await expect(saveMdxView('Sales', 'Old', 'X', false, true, undefined as never))
      .rejects.toThrow(/no longer on the server/);
  });
});

const mockAx = apiRequestFacade as unknown as ReturnType<typeof vi.fn>;

describe('_fetchViewAxisConfig MDX flag', () => {
  beforeEach(() => mockAx.mockReset());

  it('returns isMdx=true and mdx text for an MDXView', async () => {
    // Call 1: ?$select=Name → @odata.type identifies the view type
    mockAx.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ '@odata.type': '#ibm.tm1.api.v1.MDXView', Name: 'TestMdxView' }),
    });
    // Call 2: ?$select=MDX → MDX text
    mockAx.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ MDX: 'WITH MEMBER [m] AS 1 SELECT NON EMPTY {} ON COLUMNS, NON EMPTY {} ON ROWS FROM [Sales]' }),
    });
    const r = await _fetchViewAxisConfig('Sales', 'TestMdxView', false, undefined as never);
    expect(r?.isMdx).toBe(true);
    expect(r?.mdx).toContain('FROM [Sales]');
  });

  it('returns isMdx=false for a NativeView', async () => {
    // Call 1: ?$select=Name → NativeView @odata.type (even when the Rows/Columns
    // $expand would 400, classification stays correct)
    mockAx.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ '@odata.type': '#ibm.tm1.api.v1.NativeView', Name: 'NativeView' }),
    });
    // Call 2: ?$select=SuppressEmptyRows,SuppressEmptyColumns → suppress flags
    mockAx.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ SuppressEmptyRows: false, SuppressEmptyColumns: false }),
    });
    // Remaining calls (Rows/Columns expand, Titles) default to undefined and are
    // guarded — the row/col dims come from the executed cellset on refresh.
    const r = await _fetchViewAxisConfig('Sales', 'NativeView', false, undefined as never);
    expect(r?.isMdx).toBe(false);
    expect(r?.mdx).toBeUndefined();
  });
});

describe('resolveMdxSaveTarget', () => {
  it('valid saveMdxView msg → target with overwrite+isPrivate from msg', () => {
    const r = resolveMdxSaveTarget({ type: 'saveMdxView', mdx: 'X', viewName: 'MyView', isPrivate: true, overwrite: true } as any);
    expect(r).toEqual({ viewName: 'MyView', isPrivate: true, overwrite: true, mdx: 'X' });
  });
  it('empty viewName → null', () => {
    expect(resolveMdxSaveTarget({ type: 'saveMdxView', mdx: 'X', viewName: '  ', isPrivate: false, overwrite: false } as any)).toBeNull();
  });
  it('overwrite:false passed through', () => {
    const r = resolveMdxSaveTarget({ type: 'saveMdxView', mdx: 'Y', viewName: 'NewV', isPrivate: false, overwrite: false } as any);
    expect(r).toEqual({ viewName: 'NewV', isPrivate: false, overwrite: false, mdx: 'Y' });
  });
});

describe('mdxMayLoseContent', () => {
  it('warns when original has WITH MEMBER and saving differs', () => {
    const orig = 'WITH MEMBER [M].[x] AS 1 SELECT {} ON 0 FROM [C]';
    expect(mdxMayLoseContent(orig, 'SELECT {} ON 0 FROM [C]')).toBe(true);
  });
  it('no warning when saving equals original', () => {
    const orig = 'WITH MEMBER [M].[x] AS 1 SELECT {} ON 0 FROM [C]';
    expect(mdxMayLoseContent(orig, orig)).toBe(false);
  });
  it('no warning for plain SELECT original', () => {
    expect(mdxMayLoseContent('SELECT {} ON 0 FROM [C]', 'SELECT {a} ON 0 FROM [C]')).toBe(false);
  });
  it('no warning when no original (new view)', () => {
    expect(mdxMayLoseContent(null, 'SELECT {} ON 0 FROM [C]')).toBe(false);
  });
});

import { buildMdxTemplate } from '../commands/cubeViewer/newMdxView';

describe('buildMdxTemplate', () => {
  it('emits a minimal SELECT with bracket escape', () => {
    expect(buildMdxTemplate('Sa]les')).toBe('SELECT {} ON COLUMNS, {} ON ROWS FROM [Sa]]les]');
  });
});
