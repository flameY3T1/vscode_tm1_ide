/**
 * Outbound actions: typed wrappers around vscode.postMessage. Keeps every
 * message-shape that the extension expects in one place so the editor and
 * the context-menu can dispatch them without duplicating the payload.
 */

import { vscode } from './vscodeApi';
import { state } from './state';
import { showToast, getTitleAssignments } from './dom';
import { buildCoordinates, cellTarget, coordinateKeys, namesDimTwice } from './pureBridge';
import type { SpreadMethod } from './pureBridge';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

/** Re-export for existing imports (`bulkWrite.ts`, `editor.ts`) — the actual
 *  definition lives in `dom.ts` (see there: cycle avoidance with `grid.ts`). */
export { getTitleAssignments };

export interface CellEditPayload {
  ri: number;
  ci: number;
  value: number | string;
  coordinates: string[];
  /** Raw picklist definition of this cell (`resolvePicklistDefForCell` in
   *  `editor.ts`) — passed through so that the host can interpret TM1's
   *  uninformative 285 error as a picklist violation and append the allowed
   *  values to the rejection message. `undefined`/`null` if the cell has
   *  none. */
  picklistDef?: string | null;
}

/**
 * What a write or spread sends for cell (ri, ci): one key per cube dimension
 * with the cube-order `coords`, unless a dimension is on the grid through two
 * hierarchies — then every member (`cellTarget`), so the write hits exactly the
 * displayed intersection instead of dropping the second hierarchy's filter.
 */
export function wireTarget(ri: number, ci: number, coords: string[]): { dimensions: string[]; coordinates: string[] } {
  const m = state.lastMatrix;
  const args = {
    cubeDims: state.dimensions || [],
    rowDims: m?.rowDims || [],
    colDims: m?.colDims || [],
    rowTuples: m?.rowTuples || [],
    colTuples: m?.colTuples || [],
    ri, ci,
    titleAssignments: getTitleAssignments(),
  };
  if (!namesDimTwice([...args.rowDims, ...args.colDims, ...Object.keys(args.titleAssignments)])) {
    return { dimensions: coordinateKeys(args), coordinates: coords };
  }
  const t = cellTarget(args);
  return { dimensions: t.keys, coordinates: t.elems };
}

export function sendCellEdit(p: CellEditPayload): void {
  vscode.postMessage({
    type: 'cellEdit',
    ri: p.ri, ci: p.ci, value: p.value,
    ...wireTarget(p.ri, p.ci, p.coordinates),
    picklistDef: p.picklistDef ?? null,
  });
}

/**
 * Dispatch a spread (`type: 'spread'`) for cell (ri, ci). Builds coordinates
 * from the current matrix + live title assignments; on coordinate-build failure
 * shows a toast and returns false (caller may rollback UI).
 */
export function sendSpread(method: SpreadMethod, value: number, ri: number, ci: number): boolean {
  const m = state.lastMatrix;
  if (!m) return false;
  let coordinates: string[];
  try {
    coordinates = buildCoordinates({
      cubeDims: state.dimensions || [],
      rowDims: m.rowDims || [],
      colDims: m.colDims || [],
      rowTuples: m.rowTuples || [],
      colTuples: m.colTuples || [],
      ri, ci,
      titleAssignments: getTitleAssignments(),
    });
  } catch (err) {
    showToast(fmt(L, 'errorPrefix', (err as Error)?.message ?? String(err)), 'error');
    return false;
  }
  vscode.postMessage({
    type: 'spread',
    ri, ci, method, value,
    ...wireTarget(ri, ci, coordinates),
  });
  return true;
}

/**
 * Multi-cell spread: builds coordinates for each (ri, ci) target and dispatches
 * one `spreadBulk` message. Extension applies sequentially and returns an
 * aggregate `spreadBulkResult`.
 */
export function sendSpreadBulk(
  method: SpreadMethod, value: number, cells: Array<{ ri: number; ci: number }>,
): boolean {
  const m = state.lastMatrix;
  if (!m || cells.length === 0) return false;
  const titleAssignments = getTitleAssignments();
  const targets: Array<{ ri: number; ci: number; coordinates: string[] }> = [];
  let dimensions: string[] = [];
  for (const cell of cells) {
    try {
      const coordinates = buildCoordinates({
        cubeDims: state.dimensions || [],
        rowDims: m.rowDims || [],
        colDims: m.colDims || [],
        rowTuples: m.rowTuples || [],
        colTuples: m.colTuples || [],
        ri: cell.ri, ci: cell.ci,
        titleAssignments,
      });
      const wire = wireTarget(cell.ri, cell.ci, coordinates);
      dimensions = wire.dimensions; // same layout for every cell
      targets.push({ ri: cell.ri, ci: cell.ci, coordinates: wire.coordinates });
    } catch (err) {
      showToast(fmt(L, 'errorPrefix', (err as Error)?.message ?? String(err)), 'error');
      return false;
    }
  }
  vscode.postMessage({
    type: 'spreadBulk',
    method, value, targets, dimensions,
  });
  return true;
}

/**
 * Dispatch a `resolvePicklist` request for a raw picklist definition (as
 * produced by `pickDefinitionForCell`). `reqId` is stamped by the caller
 * from the shared `picklistReqSeq.ts` counter (Fix round 1, Finding 1) —
 * dedicated to picklist round trips and deliberately separate from the
 * `_reqSent`/`nextReqId` refresh-generation guard (`reqGuard.ts`) that
 * `messaging.ts#isCurrentResponse` checks incoming `cellData`/`error`
 * against. Both `editor.ts` (one open editor at a time) and `paste.ts` (an
 * insert can resolve several definitions in parallel) share this one
 * counter, so the matching `picklistValues` response can always be told
 * apart from an answer to a round trip that has since moved on.
 */
export function sendResolvePicklist(def: string, reqId: number): void {
  vscode.postMessage({ type: 'resolvePicklist', def, reqId });
}

/**
 * Ask the host for the raw picklist definition of EXACTLY ONE cell — the lazy
 * cell level (Task 15). Sent only when neither the attribute map nor the rule
 * map knows this cell.
 *
 * One cell, never a range: measured against 11.8, a single cell costs 1–2 ms
 * even when never queried before, 417 cells in one cellset cost 12.5 s, and
 * the window of a real saved view ran for over ten minutes before it had to be
 * cancelled server-side. Uses the same `picklistReqSeq` counter as
 * `sendResolvePicklist` — never the `_reqSent` refresh generation.
 */
export function sendFetchCellPicklist(
  coordinates: string[], reqId: number,
): void {
  vscode.postMessage({
    type: 'fetchCellPicklist', coordinates, dimensions: _coordinateKeys(), reqId,
  });
}

/**
 * Dispatch a per-cell trace (`type: 'trace'`) for cell (ri, ci). Builds
 * coordinates from the current matrix + live title assignments; on
 * coordinate-build failure shows a toast and returns false.
 */
export function sendTrace(kind: 'rule' | 'feeders' | 'check', ri: number, ci: number): boolean {
  const coordinates = _cellCoordinates(ri, ci);
  if (!coordinates) return false;
  vscode.postMessage({ type: 'trace', kind, coordinates, dimensions: _coordinateKeys() });
  return true;
}


/** Axis key per cube dimension, parallel to `_cellCoordinates`: trace and
 *  picklist address the hierarchy the coordinate was taken from. */
function _coordinateKeys(): string[] {
  const m = state.lastMatrix;
  return coordinateKeys({
    cubeDims: state.dimensions || [],
    rowDims: m?.rowDims || [],
    colDims: m?.colDims || [],
    titleAssignments: getTitleAssignments(),
  });
}

/** Coordinates of a cell in cube dimension order; reports the error itself. */
function _cellCoordinates(ri: number, ci: number): string[] | undefined {
  const m = state.lastMatrix;
  if (!m) return undefined;
  try {
    return buildCoordinates({
      cubeDims: state.dimensions || [],
      rowDims: m.rowDims || [],
      colDims: m.colDims || [],
      rowTuples: m.rowTuples || [],
      colTuples: m.colTuples || [],
      ri, ci,
      titleAssignments: getTitleAssignments(),
    });
  } catch (err) {
    showToast(fmt(L, 'errorPrefix', (err as Error)?.message ?? String(err)), 'error');
    return undefined;
  }
}
