import { escapeMdx, escapeMdxString } from '../utils/odataKey';
import { hierMdxRef, memberMdxRef } from '../utils/hierKeyPure';
import type { ViewDimSelection } from './viewTypes';

/**
 * Expresses the axis layout the viewer holds in memory as an MDX statement,
 * so a custom axis can be read without first persisting a temp NativeView.
 *
 * Why bother: the cellset a NativeView produces is 4–5× slower to READ than
 * the one `ExecuteMDX` produces for the identical grid (measured 11.8,
 * 2026-08-08: 388 ms vs 87 ms over 12k cells, and the gap holds per page, so
 * it is not a warm-up effect). On top of that the temp-view detour costs a
 * POST and a DELETE per refresh.
 *
 * Every reference form stays SYMBOLIC — a registered subset becomes
 * `TM1SUBSETTOSET`, a whole dimension `TM1SUBSETALL`. Only an explicit element
 * pick is enumerated, because that is what the user typed. That keeps the
 * promise that a 295k-row axis never travels as a member list.
 *
 * Anything that cannot be said in MDX returns `null`; the caller then falls
 * back to the temp NativeView. The one known case is a PRIVATE subset:
 * `TM1SUBSETTOSET` cannot address one, only `Subset@odata.bind` can.
 */

export interface ViewMdxInput {
  cubeName: string;
  rowDims: string[];
  colDims: string[];
  /** Context dimensions → the single member each is sliced at. */
  titleAssignments: Record<string, string>;
  dimSelections: Record<string, ViewDimSelection>;
  suppressRows: boolean;
  suppressCols: boolean;
}

const hierRef = hierMdxRef;
const memberRef = memberMdxRef;

/**
 * The set expression for one axis dimension, or `null` when the selection has
 * no MDX form.
 */
export function buildAxisSetMdx(dim: string, sel: ViewDimSelection | undefined): string | null {
  if (sel?.kind === 'expression') { return sel.expression; }
  if (sel?.kind === 'namedSubset') {
    // A private subset is reachable by OData bind only — see the module note.
    if (sel.isPrivate) { return null; }
    // MDX string literals escape a quote by doubling it (live 11.8).
    return `{TM1SUBSETTOSET(${hierRef(dim)}, "${escapeMdxString(sel.name)}")}`;
  }
  if (sel?.kind === 'elements' && sel.names.length > 0) {
    return `{${sel.names.map((e) => memberRef(dim, e)).join(', ')}}`;
  }
  if (sel?.kind === 'consolidation') { return `{${memberRef(dim, sel.name)}}`; }
  return `{TM1SUBSETALL(${hierRef(dim)})}`;
}

/** Cross product of several dimensions on one axis, in the given order. */
function crossjoin(sets: string[]): string {
  return sets.reduce((acc, s) => (acc === '' ? s : `CROSSJOIN(${acc}, ${s})`), '');
}

function axisMdx(dims: string[], dimSelections: Record<string, ViewDimSelection>): string | null {
  const sets: string[] = [];
  for (const d of dims) {
    const s = buildAxisSetMdx(d, dimSelections[d]);
    if (s === null) { return null; }
    sets.push(s);
  }
  return sets.length > 0 ? crossjoin(sets) : null;
}

/**
 * The full statement, or `null` when the layout has no MDX form and the caller
 * must fall back to a temp NativeView.
 */
export function buildViewMdx(input: ViewMdxInput): string | null {
  const { cubeName, rowDims, colDims, titleAssignments, dimSelections } = input;
  const cols = axisMdx(colDims, dimSelections);
  const rows = axisMdx(rowDims, dimSelections);
  if (cols === null || rows === null) { return null; }

  // A dimension that sits on an axis is enumerated there; slicing it too would
  // contradict the axis.
  // Per hierarchy: another hierarchy of an axis dimension is a valid slicer.
  const axisDims = new Set([...rowDims, ...colDims]);
  const slicer = Object.entries(titleAssignments)
    .filter(([dim]) => !axisDims.has(dim))
    .map(([dim, elem]) => memberRef(dim, elem));

  const colPrefix = input.suppressCols ? 'NON EMPTY ' : '';
  const rowPrefix = input.suppressRows ? 'NON EMPTY ' : '';
  return `SELECT ${colPrefix}${cols} ON 0, ${rowPrefix}${rows} ON 1 FROM [${escapeMdx(cubeName)}]`
    + (slicer.length > 0 ? ` WHERE (${slicer.join(', ')})` : '');
}
