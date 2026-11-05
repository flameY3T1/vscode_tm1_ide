export {};

/**
 * Which attributes appear as their own column, and how wide each one is.
 *
 * This is its own module and a sheet without imports: the state is set by the
 * control, read by the renderer and ordered by `fetchRows()` - three readers, none of
 * which owns it on behalf of the others.
 *
 * The order IS the selection order. There is deliberately no reordering
 * (see the spec, "Deliberately not included"), so nothing here may sort.
 */

/**
 * The two PLACEHOLDER COLUMNS: element index and edge weight.
 *
 * Why they are column names at all and not separate switches: they should
 * behave like any other column - tick them, keep them in selection order,
 * resize them by dragging, remember them per server and dimension. As a
 * separate pair of switches each of these four capabilities would have to be
 * built a second time.
 *
 * Why a character from the PRIVATE USE AREA (U+E000/U+E001) in front: the name
 * must not be able to collide with any real attribute name.
 *
 * NUL would be the obvious choice and is WRONG here - measured 2026-08-25,
 * after exactly that showed up three times in the click test (column empty,
 * `�` in the header, the button did not count the
 * choice). The HTML tokenizer replaces U+0000 in an attribute value with
 * U+FFFD, both at parser entry and via `innerHTML`. The name therefore came
 * back from the DOM as `�index`, which was no longer a placeholder but an
 * "attribute" that does not exist - and each of the three symptoms follows
 * from that. U+E000, U+0001 and U+FFFF pass through unchanged; U+E000 is the
 * only one of them that is neither a control character nor a noncharacter.
 *
 * The NUL row-key separator (formerly `rowIdentity.ts#rowKey`) stays correct: it lives only in
 * memory and never touches the DOM. Do not "fix" it along the way.
 *
 * They are INTERNAL TO THE WEBVIEW. On the wire there are two flags
 * (`rowIndex`/`rowWeight`), because the host must not order them as
 * attributes - see `protocol.ts#rowIndex`. The translation happens in
 * `viewFetch.ts#fetchRows`.
 */
export const COL_INDEX = '\uE000index';
export const COL_WEIGHT = '\uE001weight';

/** Both placeholders, in the order in which the tick list shows them. */
export const PSEUDO_COLS: readonly string[] = [COL_INDEX, COL_WEIGHT];

/** Is this a placeholder column rather than an attribute? */
export function isPseudoCol(name: string): boolean {
  return name === COL_INDEX || name === COL_WEIGHT;
}

/** Only the REAL attribute names - what goes to the host as `rowAttrs`. */
export function realAttrCols(cols: readonly string[]): string[] {
  return cols.filter((c) => !isPseudoCol(c));
}

/** Default width of a new column, in pixels. */
export const DEFAULT_COL_PX = 160;

/** Narrower is not possible - below this the column would be there but unreadable. */
export const MIN_COL_PX = 40;

/** Default width of the two placeholder columns - they show short numbers. */
export const PSEUDO_COL_PX = 80;

let _columns: string[] = [];
const _widths = new Map<string, number>();

/** The chosen columns, in selection order. A copy. */
export function attrColumns(): readonly string[] {
  return _columns.slice();
}

/** Set the selection. Deduplicated; empty names are dropped. */
export function setAttrColumns(names: readonly string[]): void {
  const seen = new Set<string>();
  _columns = [];
  for (const n of names) {
    if (!n || seen.has(n)) { continue; }
    seen.add(n);
    _columns.push(n);
  }
}

/** The width of a column in pixels; unknown means the default. */
export function columnWidth(name: string): number {
  // Index and weight are short numbers - 160 px would be mostly empty space there.
  return _widths.get(name) ?? (isPseudoCol(name) ? PSEUDO_COL_PX : DEFAULT_COL_PX);
}

/**
 * Set the width of a column; values below MIN_COL_PX are clamped.
 *
 * `Math.round`: the caller (drag handle, `colResize.ts`) delivers widths from
 * `clientX` differences - those are not guaranteed to be integers.
 */
export function setColumnWidth(name: string, px: number): void {
  _widths.set(name, Math.max(MIN_COL_PX, Math.round(px)));
}

/** For tests: reset everything. */
export function _resetAttrColumnsForTest(): void {
  _columns = [];
  _widths.clear();
}
