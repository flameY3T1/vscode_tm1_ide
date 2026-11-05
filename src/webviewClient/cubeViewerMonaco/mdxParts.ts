// Pure MDX building kit, previously copy-pasted three times in mdxBuild /
// mdxPivotPure / mdxSlicerPure (member reference, axis set, CROSSJOIN folding,
// SELECT skeleton). One place instead of three copies that would have to be
// kept in sync on every change to the MDX shape. Pure (no vscode import,
// `pure-no-vscode` / `webview-no-vscode`) - real webview JS, single backslash
// in escapes.

import { escapeMdx, memberOccurrencesMdx } from '../../utils/odataKey';
import { hierMdxRef, memberMdxRef } from '../../utils/hierKeyPure';

// `]` → `]]` - canonical in `utils/odataKey`. The `String()` stays: callers
// sometimes pass names from state/matrix tuples that, despite the `string`
// type, can occasionally be undefined at runtime.
function escBr(name: string): string {
  return escapeMdx(String(name));
}

/** `[dim].[hier].[elem]` for a viewer key (`dim` or `dim:hier`, hierKeyPure). */
export function memberRef(dim: string, elem: string): string {
  return memberMdxRef(String(dim), String(elem));
}

/**
 * Element set of a dimension for an axis/the WHERE slicer. Empty/undefined
 * means "no explicit selection" (axis without a subset, title dimension
 * without an assignment) - TM1SUBSETALL instead of an empty `{}`, otherwise the
 * dimension drops out of the cross product instead of meaning "all elements".
 */
export function dimSet(dim: string, names: string[] | undefined): string {
  if (!names || names.length === 0) {
    return `{ TM1SUBSETALL( ${hierMdxRef(String(dim))} ) }`;
  }
  return `{ ${names.map((n) => memberRef(dim, n)).join(', ')} }`;
}

/**
 * Collapse state as an expression: expand or collapse an axis set around ONE
 * node without enumerating the members. Needed for axes that travel as an
 * expression (`kind: 'expression'`) - there is no name list in which children
 * could be entered or removed.
 *
 * Measured live (11.8, on an accounts dimension, 2026-08-20,
 * cvDrillOccurrenceProbe{,2}.js):
 *
 *  • `DRILLDOWNMEMBER(set, {X})` inserts the children in place and affects
 *    EVERY occurrence of `X`: `{A,B,A}` → 11 rows, both `A` blocks expanded.
 *  • `DRILLUPMEMBER(set, {X})` removes the run of descendants behind `X` -
 *    likewise for every occurrence: `{A,children,B,A,children}` (11) → `{A,B,A}`.
 *
 * On an expression axis, collapsing is therefore a statement about the MEMBER,
 * not about one occurrence. The grid reflects this correctly on its own: both
 * blocks lose their children, so both triangles read "collapsed"
 * (`gridPure#isCollapsedByDisplay`).
 *
 * Nesting is allowed and the normal case - the axis of a saved view is often
 * already a multi-layer `DRILL*MEMBER` (7 layers checked live,
 * cvChipAxisProbe.js).
 */
export function drillDownMemberSet(setMdx: string, dim: string, elem: string): string {
  return `{DRILLDOWNMEMBER(${setMdx}, ${memberOccurrencesMdx(hierMdxRef(String(dim)), String(elem))})}`;
}

/** Counterpart to `drillDownMemberSet` - see there for the measurement. */
export function drillUpMemberSet(setMdx: string, dim: string, elem: string): string {
  return `{DRILLUPMEMBER(${setMdx}, ${memberOccurrencesMdx(hierMdxRef(String(dim)), String(elem))})}`;
}

/**
 * Express the DISPLAY collapse state over an ARBITRARY set.
 *
 * Not `DRILLUPMEMBER`: that only works on a tree run. On a foreign list - the
 * normal case for a saved MDX view - it is a SILENT no-op. Measured live
 * (11.8, `Cube A`, view `Default`, 2026-08-23, probes in the session
 * log):
 *
 *   DRILLUPMEMBER({TM1SUBSETALL(Accounts)}, {Total})   160659 → 160636  ✔
 *   DRILLUPMEMBER({EXCEPT(<list of the view>)}, ditto)         14 → 14     ✘
 *   EXCEPT(<list>, EXCEPT(DESCENDANTS(m), {m}, ALL), ALL)      14 → 4      ✔
 *
 * Two subtleties, both measured:
 *  • `DESCENDANTS(m)` includes `m` ITSELF - without the inner `EXCEPT` the
 *    collapsed row disappears together with its block (14 → 3).
 *  • `ALL` keeps duplicates; without `ALL`, `EXCEPT` deduplicates
 *    (`{VZP,VZP}` → 1). An element can appear on an axis several times, and
 *    that must not vanish as a side effect.
 *
 * The rule affects EVERY occurrence of the member - which is exactly what the
 * grid does too: `state.collapsed` is keyed by NAME, and `_colHidden` hides
 * every row whose ancestor chain contains a collapsed name.
 */
export function collapseMemberSet(setMdx: string, dim: string, elem: string): string {
  const m = memberRef(dim, elem);
  return `{EXCEPT(${setMdx}, EXCEPT(DESCENDANTS(${m}), {${m}}, ALL), ALL)}`;
}

/**
 * Folds the subsets of several axis dimensions into one CROSSJOIN.
 * Empty input ("no dimension on the axis") yields `{}` - the only MDX that
 * TM1 accepts for that; a single dimension needs no CROSSJOIN and stays
 * unwrapped.
 */
export function crossjoinAll(sets: string[]): string {
  if (sets.length === 0) { return '{}'; }
  if (sets.length === 1) { return sets[0]; }
  return sets.reduce((acc, s, i) => (i === 0 ? s : `CROSSJOIN(${acc}, ${s})`));
}

export interface SelectStatementInput {
  cube: string;
  rowSet: string;
  colSet: string;
  /** Finished member references (already built via `memberRef`); empty = no WHERE. */
  titleMembers: string[];
  suppressRows: boolean;
  suppressCols: boolean;
}

/**
 * SELECT skeleton - identical line for line between the state-based builder
 * (`mdxBuild`) and the pivot builder (`mdxPivotPure`); only the sets
 * themselves (rowSet/colSet/titleMembers) differ between the callers.
 */
export function selectStatement(inp: SelectStatementInput): string {
  const whereClause = inp.titleMembers.length
    ? `\nWHERE ( ${inp.titleMembers.join(', ')} )`
    : '';
  const rowPrefix = inp.suppressRows ? 'NON EMPTY ' : '';
  const colPrefix = inp.suppressCols ? 'NON EMPTY ' : '';

  return [
    'SELECT',
    `  ${colPrefix}${inp.colSet} ON COLUMNS,`,
    `  ${rowPrefix}${inp.rowSet} ON ROWS`,
    `FROM [${escBr(inp.cube)}]${whereClause}`,
  ].join('\n');
}
