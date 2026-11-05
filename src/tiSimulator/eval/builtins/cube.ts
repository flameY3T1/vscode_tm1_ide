/**
 * Cube lifecycle + cell-read built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Two named arrays kept in source-line order:
 *  - CUBE_LIFECYCLE_BUILTINS (section 14, L1092-1102) — destroy/security/locking.
 *  - CELL_READ_BUILTINS      (section 21, L1532-1559) — CellGetN/S.
 */

import { cubeCellKey, type Fixtures, type Value } from '../../types';
import { type Builtin, asString, noopVoid } from './_helpers';

// ── Section 14 — Cube + view + rule lifecycle (sim does not model these objects) ─
export const CUBE_LIFECYCLE_BUILTINS: Builtin[] = [
  noopVoid('CubeCreate', 2, 64),
  noopVoid('CubeDestroy', 1),
  noopVoid('CubeDelete', 1),
  noopVoid('CubeRuleDestroy', 1),
  noopVoid('RuleDestroy', 1),
  noopVoid('CellSecurityCubeCreate', 1),
  noopVoid('CellSecurityCubeDestroy', 1),
  noopVoid('CubeDataReservationRelease', 1, 64),
  noopVoid('CubeDRRelease', 2),
  noopVoid('HierarchyElementSecurityPut', 5),
];

// ── Section 21 — Cell-read functions (need fixtures.cubeCells) ────────
const readCellN = (args: Value[], fx: Fixtures | undefined, name: string): number => {
  if (args.length < 2) throw new Error(`${name}: needs at least 2 args (cube, e1)`);
  const key = cubeCellKey(asString(args[0]), args.slice(1).map(asString));
  const v = fx?.cubeCells.get(key);
  // FINDING #5: a miss is indistinguishable from a legitimately-empty cell —
  // record it (if a sink is present) so the runner can aggregate ONE warning.
  if (v === undefined) {
    fx?.cellReadMisses?.add(key);
    return 0;
  }
  return typeof v === 'number' ? v : Number(v) || 0;
};

const readCellS = (args: Value[], fx: Fixtures | undefined, name: string): string => {
  if (args.length < 2) throw new Error(`${name}: needs at least 2 args (cube, e1)`);
  const key = cubeCellKey(asString(args[0]), args.slice(1).map(asString));
  const v = fx?.cubeCells.get(key);
  // FINDING #5: see readCellN — record the uncaptured coord before the '' fallback.
  if (v === undefined) {
    fx?.cellReadMisses?.add(key);
    return '';
  }
  return typeof v === 'string' ? v : String(v);
};

export const CELL_READ_BUILTINS: Builtin[] = [
  { name: 'CellGetN', invoke: (a, fx) => readCellN(a, fx, 'CellGetN') },
  { name: 'CellGetS', invoke: (a, fx) => readCellS(a, fx, 'CellGetS') },
  // Aliases with identical fixture-backed semantics (CubeGet* / CellValue*).
  { name: 'CubeGetN', invoke: (a, fx) => readCellN(a, fx, 'CubeGetN') },
  { name: 'CubeGetS', invoke: (a, fx) => readCellS(a, fx, 'CubeGetS') },
  { name: 'CellValueN', invoke: (a, fx) => readCellN(a, fx, 'CellValueN') },
  { name: 'CellValueS', invoke: (a, fx) => readCellS(a, fx, 'CellValueS') },
  {
    // CellIsUndefined(cube, e1…eN) → 1 when the intersection has no captured
    // value (never written), else 0.
    name: 'CellIsUndefined',
    invoke: (a, fx) => {
      if (a.length < 2) throw new Error('CellIsUndefined: needs at least 2 args (cube, e1)');
      return fx?.cubeCells.has(cubeCellKey(asString(a[0]), a.slice(1).map(asString))) ? 0 : 1;
    },
  },
];
