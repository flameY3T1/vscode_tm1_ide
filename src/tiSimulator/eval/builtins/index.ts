/**
 * TI built-in registry — entry point.
 * Hebel 11 (2026-05-17): replaces the 1570-LOC monolith
 * builtins.ts (later a thin re-export facade, since removed).
 *
 * The category arrays are concatenated in EXACT source-section order so the
 * `for (const b of BUILTINS) REGISTRY.set(...)` last-wins semantics matches
 * the pre-split behaviour bit-for-bit. Do not reorder without auditing
 * duplicate-name entries (e.g. SubsetMDXSet noopVoid stub in subset.ts:
 * SUBSET_OPS_BUILTINS gets overridden by the full impl in SUBSET_PROPS_BUILTINS).
 */

import type { Builtin } from './_helpers';
import { PROC_INTRO_BUILTINS, TRAN_BUILTINS } from './proc';
import { STRING_MISC_BUILTINS } from './string';
import { DATE_BUILTINS } from './date';
import {
  DIM_QUERY_BUILTINS,
  DIM_MUT_BUILTINS,
  HIER_LIFECYCLE_BUILTINS,
  HIER_QUERY_BUILTINS,
  ELEM_EXTRAS_BUILTINS,
} from './dim';
import {
  SUBSET_OPS_BUILTINS,
  SUBSET_QUERY_BUILTINS,
  SUBSET_EXTRAS_BUILTINS,
  SUBSET_PROPS_BUILTINS,
  HIER_SUBSET_BUILTINS,
} from './subset';
import {
  VIEW_INFRA_STUBS_BUILTINS,
  VIEW_REGISTRY_BUILTINS,
  VIEW_AXIS_BUILTINS,
} from './view';
import {
  ATTR_BASE_BUILTINS,
  ATTR_ALIAS_BUILTINS,
  OBJ_ATTR_BUILTINS,
} from './attr';
import { FILE_OUTPUT_BUILTINS } from './file';
import { CUBE_LIFECYCLE_BUILTINS, CELL_READ_BUILTINS } from './cube';
import { MISC_BUILTINS } from './misc';
import { ELEM_READ_BUILTINS } from './elemread';
import { WRITE_OPS_BUILTINS } from './writeOps';
import { MATH_BUILTINS } from './math';
import { OBJECT_ATTR_READ_BUILTINS } from './objectAttrRead';
import { JSON_BUILTINS } from './json';
import { DATE_FORMAT_BUILTINS } from './dateFormat';
import { DIRECT_VARIANT_BASES } from '../../../tiTestFramework/log/logSchema';

export type { Builtin };

/**
 * Master builtin list. Order replicates the original `builtins.ts` source
 * section ordering — last-wins on duplicate names.
 */
const BUILTINS: Builtin[] = [
  // sec 1a (proc intro): ProcessExitNormal, Execute/RunProcess
  ...PROC_INTRO_BUILTINS,
  // sec 1b (string/misc): NumberToString through TimSt
  ...STRING_MISC_BUILTINS,
  // sec 2 (dim queries): TabDim, CubeExists, DIMIX, DIMNM, DIMSIZ, ELLEV, ...
  ...DIM_QUERY_BUILTINS,
  // sec 3 (date): Today, Now, DAY, MONTH, YEAR, DAYNO, AddMonths
  ...DATE_BUILTINS,
  // sec 4 (dim mutation): DimensionCreate/Destroy/ElementInsert/Delete...
  ...DIM_MUT_BUILTINS,
  // sec 5 (subset ops + stubs that get overridden later)
  ...SUBSET_OPS_BUILTINS,
  // sec 6a (view infra stubs)
  ...VIEW_INFRA_STUBS_BUILTINS,
  // sec 6b (subset queries: SubsetExists/Destroy/...)
  ...SUBSET_QUERY_BUILTINS,
  // sec 7 (element attributes: ElementAttrPut/Get, AttrPut/Get, AttrInsert/Delete)
  ...ATTR_BASE_BUILTINS,
  // sec 8 (file output)
  ...FILE_OUTPUT_BUILTINS,
  // sec 9 (attr aliases: ElementAttrInsert, AttributePut, ...)
  ...ATTR_ALIAS_BUILTINS,
  // sec 10 (object attribute schema mutations for control cubes)
  ...OBJ_ATTR_BUILTINS,
  // sec 11 (hierarchy lifecycle no-ops)
  ...HIER_LIFECYCLE_BUILTINS,
  // sec 12 (hierarchy read queries)
  ...HIER_QUERY_BUILTINS,
  // sec 13 (element extras: ElementInsert/Delete legacy aliases, TopElementInsert)
  ...ELEM_EXTRAS_BUILTINS,
  // sec 14 (cube/view/rule lifecycle: CubeCreate/Destroy, RuleDestroy, etc.)
  ...CUBE_LIFECYCLE_BUILTINS,
  // sec 15 (view registry: ViewCreate, ViewMDXSet, ...)
  ...VIEW_REGISTRY_BUILTINS,
  // sec 16 (view axis setters — overrides sec 6a stubs)
  ...VIEW_AXIS_BUILTINS,
  // sec 17 (subset extras: SubsetDelete — non-standard spelling of SubsetDestroy)
  ...SUBSET_EXTRAS_BUILTINS,
  // sec 18 (subset properties: SubsetMDXSet/IsAllSet/AliasSet/Get — overrides sec 5 stubs)
  ...SUBSET_PROPS_BUILTINS,
  // sec 19 (hierarchy-named subset family — overrides sec 5 stubs)
  ...HIER_SUBSET_BUILTINS,
  // sec 20 (tran / lifecycle no-ops)
  ...TRAN_BUILTINS,
  // sec 21 (cell-read: CellGetN, CellGetS)
  ...CELL_READ_BUILTINS,
  // sec 22 (misc no-ops: LogOutput, Sleep, sandbox/log-change, globals, CellIsUpdateable)
  ...MISC_BUILTINS,
  // sec 23 (element/dim read: ElementIndex/Name/Type/Level/Component/Parent/Weight/
  // Attr + legacy EL*/ATTR* + DNLEV/DimensionElementExists — overrides ElementComponentCount stub)
  ...ELEM_READ_BUILTINS,
  // sec 24 (batch ⑥ write/security/file no-ops: ASCIIDelete, CubeClearData,
  // DimensionDeleteAllElements, view/subset attr puts, AddClient/DeleteGroup, ...)
  ...WRITE_OPS_BUILTINS,
  // sec 25 (batch ⑦ common reads: pure numeric/trig — ABS/SQRT/LN/LOG/SIN/…)
  ...MATH_BUILTINS,
  // sec 26 (object-level attribute reads: Cube/Dim/Hierarchy/Subset/View/Chore/
  // Process AttrN/S/NL/SL — resolved from data/attr-reads.jsonl)
  ...OBJECT_ATTR_READ_BUILTINS,
  // sec 27 (v12 JSON family: StringToJson … JsonDiff)
  ...JSON_BUILTINS,
  // sec 28 (ICU date formatting: NewDateFormatter / FormatDate / ParseDate)
  ...DATE_FORMAT_BUILTINS,
];

const REGISTRY = new Map<string, Builtin>();
for (const b of BUILTINS) REGISTRY.set(b.name.toLowerCase(), b);

// `*Direct` element writes behave like their buffered sibling in the
// simulator: there is no buffer to bypass.
for (const base of DIRECT_VARIANT_BASES) {
  const b = REGISTRY.get(base.toLowerCase());
  if (!b) throw new Error(`builtins: no ${base} to alias`);
  if (!REGISTRY.has(`${base}direct`.toLowerCase())) REGISTRY.set(`${base}direct`.toLowerCase(), { ...b, name: `${base}Direct` });
}

export function findBuiltin(name: string): Builtin | undefined {
  return REGISTRY.get(name.toLowerCase());
}

export function builtinNames(): string[] {
  return BUILTINS.map((b) => b.name);
}
