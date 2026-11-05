/**
 * Reduce a stream of low-level log rows into the deterministic shape used by
 * the diff engine. Cell ops collapse to a single final value per (cube,coord).
 * Other op kinds keep their full action-list (insertion order matters) but
 * gain stable secondary sorting helpers for diff comparison.
 */

import {
  type LogRow,
  type CellOp,
  type DimOp,
  type AttrOp,
  type SubsetOp,
  type ViewOp,
  type CubeOp,
  type TranOp,
  type GenericMetaRow,
  isCellOp,
  isDimOp,
  isAttrOp,
  isTranOp,
  cellKey,
  META_OPS,
} from './logSchema';

/** File-output meta ops whose first arg is a file path. */
const FILE_PATH_META_OPS: ReadonlySet<string> = new Set<string>([
  '__TEXTOUTPUT__',
  '__ASCIIOUTPUT__',
  '__ASCIIOUTPUTOPEN__',
  '__ASCIIOUTPUTCLOSE__',
]);

/**
 * Reduce a file-output meta row's path arg to its basename. The path is built
 * at runtime from `GetProcessErrorFileDirectory() | 'name.txt'`, so the
 * directory prefix is server-/environment-specific and differs between the
 * recorded baseline and a replay run — a spurious diff. Comparing only the
 * filename makes the two runs line up. Non-path args are left untouched.
 */
export function normalizeFilePathMetaRow(row: GenericMetaRow): GenericMetaRow {
  // Canonicalize negative-zero numeric args (`-0`, `-0,00` → `0`): TM1's
  // NumberToStringEx keeps the sign of a value that rounds to zero, but the
  // source dump's NumberToString drops it, so the replay emits `0`. Same number —
  // must compare equal (both the diff KEY and the deep-equal VALUE check).
  let changed = false;
  let args = row.args.map((a) => {
    if (/^-0([.,]0*)?$/.test(a)) {
      changed = true;
      return a.slice(1);
    }
    return a;
  });
  // File-output ops: reduce the path arg to its basename — the dir prefix is
  // built from `GetProcessErrorFileDirectory()` and is environment-specific.
  if (FILE_PATH_META_OPS.has(row.op) && args.length > 0 && /[\\/]/.test(args[0])) {
    args = [args[0].split(/[\\/]/).pop() ?? args[0], ...args.slice(1)];
    changed = true;
  }
  return changed ? { ...row, args } : row;
}

export type AggregatedCell = {
  cube: string;
  coord: string[];
  value: number | string;
  hasIncrement: boolean;
  lastOp: CellOp['op'];
};

export type Aggregated = {
  cells: Map<string, AggregatedCell>;
  dimOps: DimOp[];
  attrOps: AttrOp[];
  subsetOps: SubsetOp[];
  viewOps: ViewOp[];
  cubeOps: CubeOp[];
  tranOps: TranOp[];
  /** Generic catch-all bucket for any future un-typed mutation op. */
  metaOps: GenericMetaRow[];
};

/**
 * Fold one cell write into `cells`: CellPutN/CellPutS replace the value,
 * CellIncrementN adds to a numeric value (or to 0). The one rule shared by the
 * captured-log side (`aggregateLog`) and the simulator side (`OutputCollector`).
 */
export function applyCellOp(
  cells: Map<string, AggregatedCell>, op: CellOp['op'], cube: string, coord: string[], value: number | string,
): void {
  const key = cellKey(cube, coord);
  if (op !== 'CellIncrementN') {
    cells.set(key, { cube, coord, value, hasIncrement: false, lastOp: op });
    return;
  }
  const existing = cells.get(key);
  const base = existing && typeof existing.value === 'number' ? existing.value : 0;
  cells.set(key, { cube, coord, value: base + Number(value), hasIncrement: true, lastOp: op });
}

export function aggregateLog(rows: LogRow[]): Aggregated {
  const cells = new Map<string, AggregatedCell>();
  const dimOps: DimOp[] = [];
  const attrOps: AttrOp[] = [];
  const subsetOps: SubsetOp[] = [];
  const viewOps: ViewOp[] = [];
  const cubeOps: CubeOp[] = [];
  const tranOps: TranOp[] = [];
  const metaOps: GenericMetaRow[] = [];

  for (const row of rows) {
    if (isCellOp(row)) {
      applyCellOp(cells, row.op, row.cube, row.coord, row.value);
      continue;
    }

    if (isDimOp(row)) {
      dimOps.push(row);
      continue;
    }
    if (isAttrOp(row)) {
      attrOps.push(row);
      continue;
    }
    if (
      row.op === 'SubsetCreate' ||
      row.op === 'SubsetCreateByMDX' ||
      row.op === 'SubsetElementInsert' ||
      row.op === 'SubsetElementDelete' ||
      row.op === 'SubsetDeleteAllElements' ||
      row.op === 'SubsetDestroy' ||
      row.op === 'SubsetMDXSet' ||
      row.op === 'SubsetIsAllSet' ||
      row.op === 'SubsetAliasSet'
    ) {
      subsetOps.push(row as SubsetOp);
    } else if (
      row.op === 'ViewCreate' ||
      row.op === 'ViewZeroOut' ||
      row.op === 'ViewDelete' ||
      row.op === 'ViewDestroy' ||
      row.op === 'ViewMDXSet' ||
      row.op === 'ViewSuppressZeroesSet' ||
      row.op === 'ViewZeroSuppressionSet' ||
      row.op === 'ViewRowDimensionSet' ||
      row.op === 'ViewColumnDimensionSet' ||
      row.op === 'ViewTitleDimensionSet' ||
      row.op === 'ViewTitleElementSet' ||
      row.op === 'ViewExtractSkipCalcsSet' ||
      row.op === 'ViewExtractSkipConsolidatedValuesSet' ||
      row.op === 'ViewExtractSkipRuleValuesSet' ||
      row.op === 'ViewExtractSkipZeroesSet' ||
      row.op === 'ViewExtractSkipConsolidatedStringsSet' ||
      row.op === 'ViewSubsetAssign' ||
      row.op === 'ViewStructUpdate'
    ) {
      viewOps.push(row as ViewOp);
    } else if (
      row.op === 'CubeCreate' ||
      row.op === 'CubeDestroy' ||
      row.op === 'CubeDelete' ||
      row.op === 'CubeRuleDestroy' ||
      row.op === 'RuleDestroy' ||
      row.op === 'CellSecurityCubeCreate' ||
      row.op === 'CellSecurityCubeDestroy' ||
      row.op === 'CubeDataReservationRelease' ||
      row.op === 'CubeDRRelease'
    ) {
      cubeOps.push(row as CubeOp);
    } else if (isTranOp(row)) {
      tranOps.push(row);
    } else if (META_OPS.has(row.op)) {
      metaOps.push(normalizeFilePathMetaRow(row as GenericMetaRow));
    }
    // Anything else (capture markers __CALL__/__PARAM__/__SUB_LIVE_FALLBACK__)
    // lands in no bucket and so never reaches the diff.
  }

  return { cells, dimOps, attrOps, subsetOps, viewOps, cubeOps, tranOps, metaOps };
}
