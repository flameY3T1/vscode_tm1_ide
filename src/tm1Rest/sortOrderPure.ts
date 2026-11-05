// src/tm1Rest/sortOrderPure.ts
//
// Pure building blocks for a hierarchy's sort order. No `vscode`, no REST.
//
// TM1 exposes the setting as four properties of the hierarchy (v11 also mirrors
// them in the control cube `}DimensionProperties`, which v12 does not have).
// Written through the TI function `HierarchySortOrder`. All of the following
// measured live on 11.8.02900.8 (2026-10-08, throwaway dimension). All 18
// element x component combinations set and read back through the hierarchy
// properties on 11.8 and v12: 0 mismatches; on 11.8 the control cube agreed
// every time. Unused senses read as stale values on 11.8 and as `None` on v12:
//
// - Parameter order is `(dim, hier, componentType, componentSense, elementType,
//   elementSense)`. Values are case-insensitive; an unknown value aborts the process.
// - `ByInput` is stored as an EMPTY type cell in the control cube. Its sense is not rewritten, and
//   neither is the sense for `ByHierarchy` — the sense cell then holds a stale
//   value, so it is only read for `ByName`/`ByLevel`.
// - The sort applies at once and rewrites the input order: switching back to
//   `ByInput` keeps the order the last sort produced, it does not restore the old one.
// - `ByLevel` + `Descending` puts consolidations before leaves.
import { escapeTiLiteral } from '../utils/tiLiteral';
import type { ElementSort, ComponentSort, SortOrderState } from '../dimensionEditor/model';

/** Hierarchy properties in the order `parseSortOrder` expects. */
export const SORT_PROPS = ['ElementsSortType', 'ElementsSortSense', 'ComponentsSortType', 'ComponentsSortSense'] as const;

const up = (v: unknown): string => (typeof v === 'string' ? v.trim().toUpperCase() : '');

/** Four values in `SORT_PROPS` order → state. Anything unknown reads as `input`. */
export function parseSortOrder(values: readonly unknown[]): SortOrderState {
  const [eType, eSense, cType, cSense] = values.map(up);
  const desc = (s: string | undefined): boolean => s === 'DESCENDING';
  let elements: ElementSort = 'input';
  if (eType === 'BYNAME') { elements = desc(eSense) ? 'name-desc' : 'name-asc'; }
  else if (eType === 'BYLEVEL') { elements = desc(eSense) ? 'level-desc' : 'level-asc'; }
  else if (eType === 'BYHIERARCHY') { elements = 'hierarchy'; }
  const components: ComponentSort = cType === 'BYNAME' ? (desc(cSense) ? 'name-desc' : 'name-asc') : 'input';
  return { elements, components };
}

function tiArgs(s: ElementSort | ComponentSort): [string, string] {
  switch (s) {
    case 'input': return ['ByInput', 'Ascending'];
    case 'name-asc': return ['ByName', 'Ascending'];
    case 'name-desc': return ['ByName', 'Descending'];
    case 'level-asc': return ['ByLevel', 'Ascending'];
    case 'level-desc': return ['ByLevel', 'Descending'];
    case 'hierarchy': return ['ByHierarchy', 'Ascending'];
  }
}

export function buildSetSortOrderTi(dim: string, hier: string, s: SortOrderState): string {
  const [cType, cSense] = tiArgs(s.components);
  const [eType, eSense] = tiArgs(s.elements);
  return `HierarchySortOrder('${escapeTiLiteral(dim)}','${escapeTiLiteral(hier)}',`
    + `'${cType}','${cSense}','${eType}','${eSense}');`;
}
