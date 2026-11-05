import { encodeODataKey } from '../utils/odataKey';
import { hierODataPath } from '../utils/hierKeyPure';

export type CalcType = 'Simple' | 'Consolidation' | 'Rule';
export type TraceCellStatus = 'Null' | 'Data' | 'Error';

export interface CalcNode {
  type: CalcType;
  status: TraceCellStatus;
  value: number | string | null;
  statements: string[];
  /** Element name per cube dim (only present up to the expanded name depth). */
  tuple: string[];
  /** Cube this cell lives in. Differs from the parent's for a `DB()` operand. */
  cube?: string;
  components: CalcNode[];
  /**
   * `false` when the server left `Components` out — a one-level trace returns
   * the children without their own children, and those still have to be
   * fetched. `true` means `components` is complete (possibly empty).
   */
  childrenLoaded: boolean;
}

export interface FedCell {
  tuple: string[];
  fed: boolean;
  value: number | string | null;
}

export interface FeederTraceResult {
  statements: string[];
  fedCells: FedCell[];
}

/**
 * One `Dimensions('D')/Hierarchies('H')/Elements('E')` ref per viewer key
 * (`dim` or `dim:hier`, see `hierKeyPure`) — same form as a cell write.
 */
export function buildTupleBind(dims: string[], coords: string[]): string[] {
  if (dims.length !== coords.length) {
    throw new Error(`Dimensions/Coordinates length mismatch: ${dims.length} vs ${coords.length}`);
  }
  // encodeODataKey = quote-double + URL-encode. Names with `/` (legal in TM1) must be
  // URL-encoded or they split the @odata.bind resource path → wrong/failed trace.
  return dims.map((key, i) => `${hierODataPath(key)}/Elements('${encodeODataKey(coords[i])}')`);
}

/**
 * Query for ONE level: the cell plus its direct children, the children without
 * their own `Components`. Only the PATH form of `$select` does this —
 * `Components($select=…)` is rejected with `400 Code 278`. Measured on 11.8
 * (2026-09-25): 46 ms / 44 KB for a cell whose full tree took 4.9 s / 144 MB.
 */
export const TRACE_ONE_LEVEL_QUERY =
  '$select=Type,Value,Status,Statements,Components/Type,Components/Value,Components/Status,Components/Statements' +
  '&$expand=Tuple($select=Name),Cube($select=Name),Components/Tuple($select=Name),Components/Cube($select=Name)';

function asString(v: unknown): string { return v == null ? '' : String(v); }

function mapTupleNames(raw: unknown): string[] {
  const arr = (raw as { Tuple?: unknown }).Tuple;
  return Array.isArray(arr) ? arr.map((e) => asString((e as { Name?: unknown }).Name)) : [];
}

export function mapCalcNode(raw: unknown): CalcNode {
  const r = (raw ?? {}) as Record<string, unknown>;
  const comps = r.Components;
  const stmts = r.Statements;
  const cube = (r.Cube as { Name?: unknown } | undefined)?.Name;
  return {
    type: (r.Type as CalcType) ?? 'Simple',
    status: (r.Status as TraceCellStatus) ?? 'Null',
    value: (r.Value as number | string | null) ?? null,
    statements: Array.isArray(stmts) ? stmts.map(asString) : [],
    tuple: mapTupleNames(r),
    ...(typeof cube === 'string' ? { cube } : {}),
    components: Array.isArray(comps) ? comps.map(mapCalcNode) : [],
    childrenLoaded: Array.isArray(comps),
  };
}

export function mapFedCell(raw: unknown): FedCell {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    tuple: mapTupleNames(r),
    fed: r.Fed === true,
    value: (r.Value as number | string | null) ?? null,
  };
}

export function mapFeederTrace(raw: unknown): FeederTraceResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fed = r.FedCells;
  const stmts = r.Statements;
  return {
    statements: Array.isArray(stmts) ? stmts.map(asString) : [],
    fedCells: Array.isArray(fed) ? fed.map(mapFedCell) : [],
  };
}
