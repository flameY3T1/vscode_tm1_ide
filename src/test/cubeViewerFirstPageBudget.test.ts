import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rowsForCellBudget, CELL_PAGE_BUDGET, CELL_PAGE_ROWS } from '../commands/cubeViewer/cellBudgetPure';

/**
 * The first page is where the blow-up hurt most: opening a wide view fetched
 * 10.000 rows x numCols cells in one request. These tests pin the first page to
 * the cell budget and, just as important, keep the row HEADERS in step with it —
 * a page of 50 rows behind 10.000 row labels renders as a grid of empty rows.
 */

vi.mock('../commands/cubeViewer/state', () => ({ _cellsets: new Map(), _panels: new Map([['panel#1', {}]]) }));

vi.mock('../commands/cubeViewer/cellset', () => ({
  _createCellsetFromMdx: vi.fn(async () => 'CID'),
  _loadCellsetStructure: vi.fn(),
  _fetchCellPage: vi.fn(async () => ({ values: {}, rawValues: {}, cellFlags: {} })),
  _deleteCellset: vi.fn(),
  ensureFullColTuples: vi.fn(async (tt: unknown) => tt),
  CELL_PAGE_ROWS: 10000,
}));

vi.mock('../commands/cubeViewer/cellParse', () => ({ parseTitleAndTuples: vi.fn() }));

import { _executeMdxInline } from '../commands/cubeViewer/executeMdxInline';
import { _loadCellsetStructure, _fetchCellPage } from '../commands/cubeViewer/cellset';
import { parseTitleAndTuples } from '../commands/cubeViewer/cellParse';
import { _cellsets } from '../commands/cubeViewer/state';

const CONFIG = { serverUrl: 'http://x', username: 'u', authType: 'basic' } as never;

/** Structure + tuples for a view `numCols` wide with `totalRows` rows. */
function seed(numCols: number, totalRows: number) {
  const tupleCount = Math.min(totalRows, CELL_PAGE_ROWS);
  (_loadCellsetStructure as ReturnType<typeof vi.fn>).mockResolvedValue({
    axes: [], rowAxis: {}, colAxis: {}, numCols, totalRows,
  });
  (parseTitleAndTuples as ReturnType<typeof vi.fn>).mockReturnValue({
    rowTuples: Array.from({ length: tupleCount }, (_, i) => [`R${i}`]),
    rowElements: Array.from({ length: tupleCount }, (_, i) => `R${i}`),
    colTuples: [], colElements: [], rowDims: [], colDims: [], titleAssignments: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (_cellsets as Map<string, unknown>).clear();
  (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, rawValues: {}, cellFlags: {} });
});

describe('_executeMdxInline first page', () => {
  it('requests only as many rows as the cell budget allows for a wide view', async () => {
    seed(1000, 500000);
    await _executeMdxInline('SELECT ...', CONFIG, 'panel#1');

    const rowsAsked = (_fetchCellPage as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(rowsAsked).toBe(rowsForCellBudget(1000));
    expect(rowsAsked * 1000).toBeLessThanOrEqual(CELL_PAGE_BUDGET);
  });

  it('keeps the full row page for a narrow view', async () => {
    seed(4, 500000);
    await _executeMdxInline('SELECT ...', CONFIG, 'panel#1');
    expect((_fetchCellPage as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(CELL_PAGE_ROWS);
  });

  it('truncates row headers to the rows actually fetched', async () => {
    seed(1000, 500000);
    const res = await _executeMdxInline('SELECT ...', CONFIG, 'panel#1');

    const budgeted = rowsForCellBudget(1000);
    expect(res.rowTuples.length).toBe(budgeted);
    expect(res.rowElements.length).toBe(budgeted);
    expect(res.loadedRows).toBe(budgeted);
  });

  it('marks a wide view as paged even when its row count fits one legacy page', async () => {
    // 900 rows would once have fitted in a single 10.000-row page, so `paged`
    // was false and the cellset got deleted — with a 50-row budget the grid
    // still needs to scroll-load, so the cellset must stay alive.
    seed(1000, 900);
    const res = await _executeMdxInline('SELECT ...', CONFIG, 'panel#1');

    expect(res.paged).toBe(true);
    expect(res.cellsetId).toBe('CID');
    expect((_cellsets as Map<string, unknown>).get('panel#1')).toBeTruthy();
  });

  it('still returns an unpaged result when everything fits', async () => {
    seed(4, 120);
    const res = await _executeMdxInline('SELECT ...', CONFIG, 'panel#1');
    expect(res.paged).toBe(false);
    expect(res.loadedRows).toBe(120);
  });
});
