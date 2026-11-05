import * as vscode from 'vscode';
import { apiRequest, assertOk } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { withSandbox } from '../../tm1Rest/sandboxTracker';
import { parseBody } from '../../tm1Rest/parseRest';
import type { ODataAxis, ODataCellset, ODataTuple } from '../../tm1Rest/odataTypes';
import { enc, CellFlag } from './state';
import { parseCellsPage, parseTuplesPage, RawCell } from './cellParse';

// Single source of truth lives in the pure module; re-exported because ~10 call
// sites and the messaging mocks import it from here.
import { CELL_PAGE_ROWS } from './cellBudgetPure';

// `FormatString` tells the two cellset kinds apart where they disagree about
// thousands separators — see `numberFormatPure`. Costs ~38% more bytes on the
// cell payload (measured 11.8, 2026-08-08) and no measurable time.
const CELL_SELECT = '$select=Ordinal,Value,FormattedValue,FormatString,Consolidated,RuleDerived,Updateable';

/**
 * Thrown when a cellset page/tuple fetch hits HTTP 404 — the TM1 session's
 * cellset has expired server-side (e.g. ~15min cookie-idle invalidation).
 * Distinguishes "cellset gone, recoverable via client refresh" (P1-6) from
 * any other request failure, which must keep surfacing as a generic error.
 */
export class CellsetNotFoundError extends Error {
  constructor(cellsetId: string) {
    super(`Cellset not found: ${cellsetId}`);
    this.name = 'CellsetNotFoundError';
  }
}

export interface ExecResult {
  rowElements: string[]; colElements: string[];
  values: Record<string, string>; rawValues: Record<string, string>; cellFlags: Record<string, CellFlag>;
  rowDims: string[]; colDims: string[];
  rowTuples: string[][]; colTuples: string[][];
  titleAssignments: Record<string, string>;
  numCols: number; totalRows: number; loadedRows: number; paged: boolean;
  /** Cellset id (P1-3 race protocol) — set only when `paged`, so the client can
   *  correlate later `fetchCellPage` pages with the cellset generation they
   *  came from and discard stale/superseded ones. */
  cellsetId?: string;
}

export async function _createCellsetFromView(
  cubeName: string, viewName: string, isPrivate: boolean, config: Tm1Config,
): Promise<string> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const res = await apiRequest('POST', `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')/tm1.Execute`, '{}', 0, config, withSandbox(config));
  assertOk(res, vscode.l10n.t('Execute view'));
  const body = parseBody<{ ID?: string }>(res);
  const id = String(body.ID ?? '');
  if (!id) { throw new Error('Could not determine cellset ID.'); }
  return id;
}

export async function _createCellsetFromMdx(mdx: string, config: Tm1Config): Promise<string> {
  const res = await apiRequest('POST', 'ExecuteMDX', JSON.stringify({ MDX: mdx }), 0, config, withSandbox(config));
  if (res.statusCode !== 201) {
    let msg = res.body || `HTTP ${res.statusCode}`;
    try { const j = JSON.parse(res.body); if (j?.error?.message) { msg = String(j.error.message); } } catch { /* raw */ }
    throw new Error(msg);
  }
  const id = String(parseBody<{ ID?: string }>(res).ID ?? '');
  if (!id) { throw new Error('Could not determine cellset ID.'); }
  return id;
}

export interface CellsetStructure {
  axes: ODataAxis[]; rowAxis: ODataAxis | undefined; colAxis: ODataAxis | undefined;
  numCols: number; totalRows: number;
}

export async function _loadCellsetStructure(cellsetId: string, config: Tm1Config): Promise<CellsetStructure> {
  const expand = '$expand=Axes($select=Ordinal,Cardinality;$expand=Hierarchies($select=Name;$expand=Dimension($select=Name)),Tuples($expand=Members($select=Name);$top=' + CELL_PAGE_ROWS + '))';
  const res = await apiRequest('GET', `Cellsets('${enc(cellsetId)}')?${expand}`, undefined, 0, config, withSandbox(config));
  assertOk(res, vscode.l10n.t('Load cellset structure'));
  const body = parseBody<ODataCellset>(res);
  const axes: ODataAxis[] = body.Axes ?? [];
  const colAxis = axes.find((a) => a.Ordinal === 0) ?? axes[0];
  const rowAxis = axes.find((a) => a.Ordinal === 1) ?? axes[1];
  // `??` not `||`: a genuine Cardinality===0 (empty column axis) must stay 0, otherwise
  // it fabricates a phantom column and shifts the cell-index math (skip = startRow * numCols).
  const numCols = colAxis?.Cardinality ?? (colAxis?.Tuples?.length ?? 0);
  const totalRows = rowAxis?.Cardinality ?? (rowAxis?.Tuples?.length ?? 0);
  return { axes, rowAxis, colAxis, numCols, totalRows };
}

export async function _fetchCellPage(
  cellsetId: string, startRow: number, rowCount: number, numCols: number, config: Tm1Config,
): Promise<{ values: Record<string, string>; rawValues: Record<string, string>; cellFlags: Record<string, CellFlag> }> {
  const skip = startRow * numCols;
  const top = rowCount * numCols;
  const res = await apiRequest('GET', `Cellsets('${enc(cellsetId)}')/Cells?${CELL_SELECT}&$skip=${skip}&$top=${top}`, undefined, 0, config, withSandbox(config));
  if (res.statusCode === 404) { throw new CellsetNotFoundError(cellsetId); }
  assertOk(res, vscode.l10n.t('Load cell page'));
  const env = parseBody<{ value?: RawCell[] }>(res);
  return parseCellsPage(env.value ?? [], numCols);
}

/** Fetch one page of axis tuples (row axis = ordinal 1, col axis = 0). */
export async function _fetchTuplePage(
  cellsetId: string, axisOrdinal: number, skip: number, top: number, config: Tm1Config,
): Promise<string[][]> {
  const res = await apiRequest(
    'GET',
    `Cellsets('${enc(cellsetId)}')/Axes(${axisOrdinal})/Tuples?$skip=${skip}&$top=${top}&$expand=Members($select=Name)`,
    undefined, 0, config, withSandbox(config),
  );
  if (res.statusCode === 404) { throw new CellsetNotFoundError(cellsetId); }
  assertOk(res, vscode.l10n.t('Load tuple page'));
  const env = parseBody<{ value?: ODataTuple[] }>(res);
  return parseTuplesPage(env.value ?? []).tuples;
}

/**
 * The light structure call caps both axes via nested $top, so a view with more
 * columns than CELL_PAGE_ROWS gets truncated col tuples. Refetch the full col
 * axis (ordinal 0) when that happens; otherwise return `tt` unchanged.
 */
export async function ensureFullColTuples<T extends { colTuples: string[][]; colElements: string[] }>(
  tt: T, numCols: number, cellsetId: string, config: Tm1Config,
): Promise<T> {
  if (numCols <= tt.colTuples.length) { return tt; }
  const fullCols = await _fetchTuplePage(cellsetId, 0, 0, numCols, config);
  return { ...tt, colTuples: fullCols, colElements: fullCols.map((t) => t.filter(Boolean).join(' / ')) };
}

export function _deleteCellset(cellsetId: string, config: Tm1Config): void {
  if (!cellsetId) { return; }
  apiRequest('DELETE', `Cellsets('${enc(cellsetId)}')`, undefined, 10000, config, withSandbox(config)).catch(() => { /* ignore */ });
}
