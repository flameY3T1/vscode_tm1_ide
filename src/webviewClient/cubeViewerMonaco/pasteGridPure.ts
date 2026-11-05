/**
 * Pasting into the grid: all of the decision logic, without DOM and without `vscode`
 * (`pure-no-vscode`, enforced by depcruise). `paste.ts` remains pure wiring.
 */

import { normalizeDecimal, parseEditedValue, parseStringCellValue } from './pureBridge';

/** Split clipboard text into a rectangular grid. */
export function parseClipboardGrid(text: string): Array<Array<string | null>> {
  // Strip trailing line breaks FIRST: when copying a single cell, Excel appends
  // a `\r\n`, and an empty second row would clear the cell below it because of
  // the "empty fields clear" rule.
  const trimmed = String(text ?? '').replace(/[\r\n]+$/, '');
  if (trimmed === '') { return []; }
  const rows = trimmed.split(/\r\n|\n|\r/).map((line) => line.split('\t'));
  // Pad to a rectangle: a grid with holes would have no target mapping.
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  // null = not part of the original block (the row was shorter); '' = a deliberately empty field.
  return rows.map((r) => (r.length === width ? r : r.concat(Array(width - r.length).fill(null))));
}

export interface PasteTarget { ri: number; ci: number; value: number | string }

/** A cell whose pasted text was not on the cell's (resolved) picklist.
 *  `value` is the value that would ACTUALLY be written (trimmed/parsed like
 *  `parseEditedValue`), NOT the raw clipboard text (fix round 1, finding 2).
 *  Mere surrounding whitespace, e.g. `"Offen "` from Excel, would otherwise be
 *  reported as a violation although exactly this trimmed value would have been
 *  written and the list contains it. */
export interface PicklistRejection { ri: number; ci: number; value: string }

export type PastePlan =
  | { ok: true; targets: PasteTarget[]; rejectedByPicklist?: PicklistRejection[] }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'no-anchor' }
  | {
      ok: false; reason: 'does-not-fit';
      needRows: number; needCols: number; haveRows: number; haveCols: number;
    }
  | {
      ok: false; reason: 'blocked';
      ri: number; ci: number; why: 'consolidated' | 'rule' | 'locked';
    };

export interface PasteCellRef { ri: number; ci: number }

export interface PasteInput {
  grid: Array<Array<string | null>>;
  anchor: { ri: number; ci: number } | null;
  /**
   * The currently selected cells in RAW index space (`state.selection`, in
   * insertion order). Only needed for the fill path (see `_fillCells`); if it
   * is missing, everything behaves as it did before filling existed.
   */
  selection?: PasteCellRef[];
  /**
   * Visible row/column order in RAW index space (`state.renderedRowIdx`
   * / `state.renderedColIdx`, the same indices carried by `td.dataset.ri`/`.ci`).
   * `renderGrid` filters (collapsed consolidations, `localFocus`,
   * occurrence hiding, empty-row suppression, MAX_COLS) WITHOUT renumbering
   * the remaining indices, so gaps stay in place. Pasting must therefore map
   * by POSITION in this list, not by raw row/column counts: otherwise values
   * land in cells that are not drawn at all, while the visible neighbouring
   * row stays untouched.
   */
  rowIndex: number[];
  colIndex: number[];
  cellFlags: Record<string, { c?: 1; r?: 1; u?: 0; s?: 1 } | undefined>;
  commaDecimal: boolean;
  /**
   * `"ri,ci"` -> resolved picklist values of the cell, OR `null` if a
   * definition existed but could not be resolved ("TM1 allows anything here",
   * which must be let through and is not a violation). If the entry is missing
   * altogether, the cell has no picklist, which is likewise let through.
   *
   * Omitted entirely (`undefined`) if the caller found no definition at all
   * in the area: the return shape then stays identical to the one before
   * task 12 (no `rejectedByPicklist` key), and `paste.ts` also saves itself
   * the round trip to the host when no picklist applies anywhere in the
   * area.
   */
  picklistValues?: Record<string, string[] | null>;
}

/** A target cell together with the raw clipboard text that is to land there. */
interface PastePlacement { ri: number; ci: number; raw: string }

/**
 * The fill path: ONE single copied value over a MULTI-CELL selection is
 * distributed to every selected cell (the same as in Excel). Otherwise
 * `null`, and the anchor block applies.
 *
 * Two cells are the lower bound: with exactly one selected cell, "fill" and
 * "paste from the anchor" have the same target anyway, and the anchor path
 * remains the tested normal case (it alone can report `no-anchor`/
 * `does-not-fit`). A grid with more than one field does NOT fill: there the
 * user copied a shape they want to recognise again, and tiling it over a
 * larger selection would be a decision of its own and is not required.
 */
function _fillCells(
  grid: Array<Array<string | null>>,
  selection: PasteCellRef[] | undefined,
): PastePlacement[] | null {
  if (!selection || selection.length < 2) { return null; }
  if (grid.length !== 1 || grid[0].length !== 1) { return null; }
  const raw = grid[0][0];
  if (raw === null) { return null; }
  return selection.map(({ ri, ci }) => ({ ri, ci, raw }));
}

/**
 * The anchor block: the grid starting at the anchor cell, mapped onto the
 * visible order, including the two refusals that can only arise here
 * (`no-anchor`, `does-not-fit`).
 */
function _anchorCells(
  grid: Array<Array<string | null>>,
  anchor: { ri: number; ci: number } | null,
  rowIndex: number[],
  colIndex: number[],
): { ok: true; cells: PastePlacement[] } | { ok: false; refusal: Extract<PastePlan, { ok: false }> } {
  if (!anchor) { return { ok: false, refusal: { ok: false, reason: 'no-anchor' } }; }

  // Find the anchor by POSITION in the visible order, not by the raw index
  // itself. If the anchor is not in the visible list at all (hidden
  // row/column), there is no target for it.
  const rowPos = rowIndex.indexOf(anchor.ri);
  const colPos = colIndex.indexOf(anchor.ci);
  if (rowPos === -1 || colPos === -1) { return { ok: false, refusal: { ok: false, reason: 'no-anchor' } }; }

  // The fit is measured by the block shape (including padding positions),
  // NOT by how many positions actually yield a target, otherwise a `null` at
  // the edge would quietly shrink the fit check.
  // Counting is done in VISIBLE positions (gaps from hidden rows/columns do
  // not count), not in raw index values.
  const needRows = grid.length;
  const needCols = grid[0].length;
  const haveRows = rowIndex.length - rowPos;
  const haveCols = colIndex.length - colPos;
  if (needRows > haveRows || needCols > haveCols) {
    return { ok: false, refusal: { ok: false, reason: 'does-not-fit', needRows, needCols, haveRows, haveCols } };
  }

  // `null` = this position was not part of the copied block (short row,
  // padded to a rectangle during parsing). NO target arises here, so a cell
  // at this position cannot block the paste either. `''`, by contrast, is a
  // deliberately copied empty field and counts normally (it clears the
  // cell). Confusing the two would destroy data.
  const cells: PastePlacement[] = [];
  for (let r = 0; r < needRows; r++) {
    for (let c = 0; c < needCols; c++) {
      const raw = grid[r][c];
      if (raw === null) { continue; }
      cells.push({ ri: rowIndex[rowPos + r], ci: colIndex[colPos + c], raw });
    }
  }
  return { ok: true, cells };
}

/**
 * What a paste from the anchor would do, or why it does not happen.
 *
 * Two different rules, because two different questions lie behind them
 * (fix round 1, finding 6):
 *
 * - Fit and locked cells (`does-not-fit`/`blocked`) are "all or nothing":
 *   a SINGLE non-writable cell says nothing about the others in the block,
 *   but a partial paste would never tell the user which cells are missing,
 *   so the whole block is refused and the caller writes NOTHING.
 * - A picklist rejection (`rejectedByPicklist`), by contrast, is PER CELL:
 *   the brief demands exactly that, and unlike a locked cell, a value
 *   violation is purely local. Cell A and cell B in the same block have
 *   independent lists, and a violated list says nothing about the other
 *   cell. The other, valid targets are written; the rejected ones come back
 *   as a separate list so the caller can report them.
 *
 * This check cannot anticipate server rejections, since TM1 has no
 * transactions.
 */
export function planPaste(input: PasteInput): PastePlan {
  const { grid, anchor, rowIndex, colIndex, cellFlags, commaDecimal, picklistValues, selection } = input;
  if (!grid.length || !grid[0].length) { return { ok: false, reason: 'empty' }; }

  // Fill beats the anchor block: ONE copied value over a MULTI-CELL
  // selection means "into every selected cell", not "into the anchor cell".
  const fill = _fillCells(grid, selection);
  let cells: PastePlacement[];
  if (fill) {
    cells = fill;
  } else {
    const placed = _anchorCells(grid, anchor, rowIndex, colIndex);
    if (!placed.ok) { return placed.refusal; }
    cells = placed.cells;
  }

  // Check first, then build: a single locked target prevents the whole
  // paste, so nothing may be built beforehand that someone could send by mistake.
  for (const { ri, ci } of cells) {
    const f = cellFlags[`${ri},${ci}`];
    if (f?.c === 1) { return { ok: false, reason: 'blocked', ri, ci, why: 'consolidated' }; }
    if (f?.r === 1) { return { ok: false, reason: 'blocked', ri, ci, why: 'rule' }; }
    if (f?.u === 0) { return { ok: false, reason: 'blocked', ri, ci, why: 'locked' }; }
  }

  const targets: PasteTarget[] = [];
  const rejectedByPicklist: PicklistRejection[] = [];
  for (const { ri, ci, raw } of cells) {
    // Parse FIRST, check against the list AFTER (fix round 1, finding 2/3):
    // what TM1 sees is the trimmed/parsed value (`parseEditedValue`), not the
    // raw clipboard text. A cell content like `"Offen "` from Excel would
    // otherwise be reported as a violation although exactly the trimmed
    // value would have been written and the list contains it.
    // String cell: text stays text. No decimal normalising, no number
    // parsing, otherwise "01223" becomes the number 1223 and the zero is gone.
    const parsed = cellFlags[`${ri},${ci}`]?.s === 1
      ? parseStringCellValue(raw)
      : parseEditedValue(normalizeDecimal(raw, commaDecimal));
    // There is no `spreading` when pasting (spec): the token travels as text.
    const value: number | string =
      parsed.kind === 'numeric' ? parsed.payload :
      parsed.kind === 'empty' ? '' :
      parsed.payload;

    // A deliberately empty field is NOT a picklist violation (fix round 1,
    // finding 3, coordinator's decision): whether TM1 accepts clearing a
    // picklist cell is unmeasured, and blocking it client-side on suspicion
    // would be worse than letting the server decide, especially since a
    // rejection now comes back with an explanatory message. Only a
    // NON-empty value is checked against the list.
    if (picklistValues && parsed.kind !== 'empty') {
      const allowed = picklistValues[`${ri},${ci}`];
      // `null` means "no effective list": let it through. Only a real list
      // that does not contain the value to be ACTUALLY written stops it.
      if (allowed && !allowed.includes(String(value))) {
        rejectedByPicklist.push({ ri, ci, value: String(value) });
        continue;
      }
    }

    targets.push({ ri, ci, value });
  }
  // Only send `rejectedByPicklist` along if the caller passed in
  // `picklistValues` at all, otherwise every existing
  // `toEqual({ok:true, targets:[...]})` comparison (old tests) would fail on an
  // additional but empty key.
  return picklistValues ? { ok: true, targets, rejectedByPicklist } : { ok: true, targets };
}

/**
 * Target positions of a paste block from the anchor, WITHOUT padding positions.
 * The same mapping as the second loop of `planPaste`, but callable on its own.
 * `paste.ts` needs it BEFORE `planPaste`: the picklist definitions of the
 * affected cells must first be resolved asynchronously (round trip to the
 * host), while `planPaste` itself stays synchronous and only receives the
 * finished `picklistValues` afterwards. Returns an empty list if the block
 * would have no positions at all for lack of a grid/anchor. The actual
 * refusal (`empty`/`no-anchor`/`does-not-fit`) still falls exclusively to
 * `planPaste`.
 */
export function pastePositions(
  grid: Array<Array<string | null>>,
  anchor: { ri: number; ci: number } | null,
  rowIndex: number[],
  colIndex: number[],
  selection?: PasteCellRef[],
): Array<{ ri: number; ci: number }> {
  // Fill path first: the same precedence as in `planPaste`, otherwise the
  // caller would resolve the picklists of the anchor block instead of those of the selection.
  const fill = _fillCells(grid, selection);
  if (fill) { return fill.map(({ ri, ci }) => ({ ri, ci })); }
  if (!grid.length || !grid[0].length || !anchor) { return []; }
  const rowPos = rowIndex.indexOf(anchor.ri);
  const colPos = colIndex.indexOf(anchor.ci);
  if (rowPos === -1 || colPos === -1) { return []; }

  const positions: Array<{ ri: number; ci: number }> = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (grid[r][c] === null) { continue; }
      const ri = rowIndex[rowPos + r];
      const ci = colIndex[colPos + c];
      // The block extends past the visible end (which would lead to
      // `does-not-fit` in planPaste): simply no position for it here.
      if (ri === undefined || ci === undefined) { continue; }
      positions.push({ ri, ci });
    }
  }
  return positions;
}
