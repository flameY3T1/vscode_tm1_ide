/**
 * Collects mutation operations emitted by the simulator's statement evaluator.
 *
 * Two storage layers:
 *  - `cells`: aggregated CellPutN/PutS/IncrementN per (cube, coord-tuple) so
 *    a sequence collapses to a single final value (diff-engine expectation).
 *  - `opRows`: typed `LogRow` objects for every other mutation (Dim / Attr /
 *    Subset / View / Cube / Tran). Mirrors what `captureWorkflow` writes to
 *    `expected/dim-deltas.jsonl`, allowing the simulator to diff against
 *    captured ground truth without a TM1 server round-trip.
 */

import type { Value } from '../types';
import type { LogRow } from '../../tiTestFramework/log/logSchema';
import { applyCellOp, type AggregatedCell } from '../../tiTestFramework/log/logAggregator';

export type CellOpName = 'CellPutN' | 'CellPutS' | 'CellIncrementN';

export class OutputCollector {
  private readonly cells = new Map<string, AggregatedCell>();
  private readonly _rows: { op: CellOpName; cube: string; coord: string[]; value: Value }[] = [];
  private readonly _opRows: LogRow[] = [];

  emit(op: CellOpName, cube: string, coord: string[], value: Value): void {
    this._rows.push({ op, cube, coord, value });
    if (op === 'CellPutS') {
      applyCellOp(this.cells, op, cube, coord, typeof value === 'string' ? value : String(value));
      return;
    }
    const n = typeof value === 'number' ? value : Number(value);
    applyCellOp(this.cells, op, cube, coord, Number.isFinite(n) ? n : 0);
  }

  /** Record a typed non-cell mutation row for later aggregation / diff. */
  emitOp(row: LogRow): void {
    this._opRows.push(row);
  }

  getAggregated(): Map<string, AggregatedCell> {
    return this.cells;
  }

  getRows(): { op: CellOpName; cube: string; coord: string[]; value: Value }[] {
    return this._rows;
  }

  /** Typed non-cell rows emitted by the evaluator (Dim/Attr/Subset/View/Cube/Tran). */
  getOpRows(): LogRow[] {
    return this._opRows;
  }

  /**
   * Merge a single captured LogRow into this collector's output.
   * Used by Phase-2 sub-log merging: each sub-process's captured log is
   * replayed into the actual-output so the diff sees what the sub would have
   * produced, without re-running it on the server.
   *
   * Cell ops are aggregated into `cells` (same semantics as `emit`).
   * Capture-time instrumentation markers (__CALL__, __PARAM__, __SUB_LIVE_FALLBACK__)
   * are silently dropped. All other typed ops land in `_opRows`.
   */
  appendRow(row: LogRow): void {
    if (row.op === 'CellPutN' || row.op === 'CellPutS' || row.op === 'CellIncrementN') {
      // Use the existing emit() path so cell-aggregation semantics are identical.
      const cellRow = row as import('../../tiTestFramework/log/logSchema').CellOp;
      this.emit(cellRow.op, cellRow.cube, cellRow.coord, cellRow.value);
      return;
    }
    // Drop capture-time instrumentation markers — they won't appear in actual output.
    if (row.op === '__CALL__' || row.op === '__PARAM__' || row.op === '__SUB_LIVE_FALLBACK__') {
      return;
    }
    this._opRows.push(row);
  }
}
