import type { Tm1Config } from '../../tm1Rest/transport/types';
import { _createCellsetFromMdx, _loadCellsetStructure, _fetchCellPage, _deleteCellset, ExecResult, ensureFullColTuples } from './cellset';
import { rowsForCellBudget } from './cellBudgetPure';
import { parseTitleAndTuples } from './cellParse';
import { _cellsets, _panels } from './state';

/**
 * Execute MDX into a PERSISTENT cellset and return the matrix shape the grid
 * needs, plus paging metadata. Results larger than one cell page keep the
 * cellset alive under `panelKey` so the grid can scroll-load more cell pages via
 * `fetchCellPage`; small results (or no panelKey) delete it immediately.
 *
 * The page is sized in CELLS, not rows — see `cellBudgetPure`.
 */
export async function _executeMdxInline(
  mdx: string, config: Tm1Config, panelKey?: string,
): Promise<ExecResult> {
  return _readCellsetIntoGrid(await _createCellsetFromMdx(mdx, config), config, panelKey);
}

/**
 * Shared tail of both executors (MDX and native view): read the structure and
 * the first cell page of a freshly created cellset, then keep it for paging or
 * delete it. Owns the cellset — on error it is deleted here.
 */
export async function _readCellsetIntoGrid(
  cellsetId: string, config: Tm1Config, panelKey?: string,
): Promise<ExecResult> {
  try {
    const st = await _loadCellsetStructure(cellsetId, config);
    let tt = parseTitleAndTuples(st.axes, st.rowAxis, st.colAxis);
    tt = await ensureFullColTuples(tt, st.numCols, cellsetId, config);
    const pageRows = rowsForCellBudget(st.numCols);
    const page = await _fetchCellPage(cellsetId, 0, pageRows, st.numCols, config);
    const loadedRows = Math.min(st.totalRows, pageRows);
    // The structure call fetches row tuples up to the legacy row cap, which can
    // be far more than this page covers. Trim them, or the grid draws labelled
    // rows with no cells behind them.
    if (tt.rowTuples.length > loadedRows) {
      tt = { ...tt, rowTuples: tt.rowTuples.slice(0, loadedRows), rowElements: tt.rowElements.slice(0, loadedRows) };
    }
    const paged = st.totalRows > pageRows && !!panelKey;
    // Panel closed meanwhile: its dispose already ran `dropPanelCellset`, so a
    // cellset stored now would stay on the server.
    if (paged && _panels.has(panelKey as string)) {
      _cellsets.set(panelKey as string, { id: cellsetId, numCols: st.numCols, totalRows: st.totalRows, config });
    } else {
      _deleteCellset(cellsetId, config);
    }
    return {
      ...tt,
      values: page.values, rawValues: page.rawValues, cellFlags: page.cellFlags,
      numCols: st.numCols, totalRows: st.totalRows, loadedRows, paged,
      cellsetId: paged ? cellsetId : undefined,
    };
  } catch (e) {
    _deleteCellset(cellsetId, config);
    throw e;
  }
}
