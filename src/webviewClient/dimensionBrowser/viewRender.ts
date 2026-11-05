export {};

import type { DisplayRow } from './rowsFromAnswer';
// The HTML escaping exists ONCE in `pure.ts` (delegating to `htmlUtils`). The
// hand-written copy here left `'` untouched — in an attribute value with single
// quotes that would have been an injection.
import { esc } from './pure';
import { COL_INDEX, COL_WEIGHT, isPseudoCol } from './attrColumns';

/** Indentation per level, in pixels. As in the old drawing path. */
const INDENT_PX = 14;

/**
 * Distance of the first column from the window edge.
 *
 * The name cell sets `padding-left` itself and thereby overrides the
 * 10 px from `.vw-row td` — at depth 0 it therefore sat flush against the edge
 * (click test 2026-08-23). The value is ADDED to the indentation, not
 * netted against it: it is the margin, not the first level.
 */
const MARGIN_PX = 10;

/**
 * One row. Everything it shows is in the server's answer — depth,
 * fold state, caption. The drawing path derives nothing and keeps no
 * state: it paints what it is given.
 *
 * The row carries its POSITION in the window, not its occurrence key.
 * The latter is NUL-separated, and `&#0;` is a parse error in HTML5 — the browser
 * replaces it with U+FFFD, so the key would come back altered and the
 * click would hit the wrong element. The position is unambiguous and needs no escaping;
 * the click path looks up the row through it.
 *
 * `setSize`: the total count of the set, or `-1` for unknown.
 *
 * Without it a screen reader reads out the window size as the total —
 * "3 of 5,000" where "3 of 803,808" applies. With `-1` the attribute is
 * OMITTED instead of guessed: a missing value is better than a wrong one.
 *
 * ARIA attributes are user-facing text for screen reader users — the same
 * deferral as for the trail (`viewTrail.ts:15-23`) does NOT apply here, because
 * nothing is translated here: the values are numbers/booleans, not
 * German words.
 */
export function viewRowHtml(
  row: DisplayRow, idx: number, isMarked: (name: string) => boolean = () => false,
  setSize = -1, columns: readonly string[] = [],
): string {
  const triangle = row.type === 'C'
    ? `<span class="vw-twisty${row.drilled ? ' vw-open' : ''}"></span>`
    : '<span class="vw-nokid"></span>';
  // The marking hangs on the NAME, not on the occurrence key: the same
  // element under two parents lights up in both rows, because a removal
  // also hits both.
  const marked = isMarked(row.name) ? ' row-marked' : '';
  const ariaSelected = ' aria-selected="' + (isMarked(row.name) ? 'true' : 'false') + '"';
  // `aria-level` counts from 1, `depth` from 0 — the same shift as in the
  // old path (`render.ts`).
  const ariaLevel = ' aria-level="' + (row.depth + 1) + '"';
  const ariaPosinset = ' aria-posinset="' + (idx + 1) + '"';
  const ariaSetsize = setSize >= 0 ? ' aria-setsize="' + setSize + '"' : '';
  // Only consolidations can be expanded/collapsed — on a leaf `aria-expanded`
  // would announce a control that does not exist.
  const ariaExpanded = row.type === 'C'
    ? ' aria-expanded="' + (row.drilled ? 'true' : 'false') + '"'
    : '';
  // `draggable`: the row is the handle for moving (`viewDrag.ts`).
  // NO `data-elem-name` — the OLD drag path (`dragDrop.ts`) hangs on that,
  // and it would write `state._manualRows` + `renderTable()` into the same
  // table body. It is guarded, to be sure, but two attributes with the same
  // meaning would be the next trap.
  // Consolidations carry their OWN class, not the old `type-C` vocabulary:
  // `.type-N`/`.type-S` stand unscoped in the stylesheet and attach a
  // `::before` symbol to EVERYTHING that carries the class. On a `<tr>` that would
  // be a green dot in every leaf row.
  //
  // Bold as in the Cube Viewer (`.cube-table td.cell-consolidated`, font-weight
  // 600) — the same statement should look the same. Measured 2026-08-24: bold
  // does NOT change the row height (600 like 700, font sizes 12-15, C and N
  // congruent), so the spacer arithmetic of the virtualizer remains
  // valid.
  const consolidated = row.type === 'C' ? ' vw-c' : '';
  // EXACTLY one cell per column, even if the value is missing: TM1 omits empty
  // attribute values (measured live 11.8), and an omitted cell would
  // shift the whole table from this row on.
  const attrCells = columns
    .map((c) => '<td class="vw-attr' + (isPseudoCol(c) ? ' vw-num' : '') + '">'
      + esc(columnValue(row, c)) + '</td>')
    .join('');
  return '<tr class="vw-row' + marked + consolidated + '" role="row" draggable="true" data-idx="' + idx + '"'
    + ariaSelected + ariaLevel + ariaPosinset + ariaSetsize + ariaExpanded + '>'
    + '<td style="padding-left:' + (MARGIN_PX + row.depth * INDENT_PX) + 'px">'
    + triangle + '<span class="vw-name">' + esc(row.caption) + '</span>'
    + '</td>' + attrCells + '</tr>';
}

/**
 * `offset`: the position from which `data-idx` counts. When appending a
 * window these are the rows already present — the click path looks up through
 * `data-idx` in the `rows` array, so both must use the same count.
 *
 * `isMarked`: third parameter, with `offset` in second place.
 * `setSize` (task 7): fourth parameter, see `viewRowHtml`.
 * `columns`: fifth parameter — the chosen attribute columns, in
 * selection order. Empty = as before exactly one cell per row.
 */
export function viewRowsHtml(
  rows: readonly DisplayRow[], offset = 0,
  isMarked: (name: string) => boolean = () => false,
  setSize = -1, columns: readonly string[] = [],
): string {
  let out = '';
  for (let i = 0; i < rows.length; i++) {
    out += viewRowHtml(rows[i], offset + i, isMarked, setSize, columns);
  }
  return out;
}

/** Rows above and below the visible area, against scroll jitter. */
export const VBUFFER = 12;

/** Row height when none can be measured (no layout). */
export const ROW_H_FALLBACK = 22;

export interface Slice {
  /** First position to draw, inclusive. */
  start: number;
  /** First position NOT to be drawn any more. */
  end: number;
  /** Height of the upper spacer in pixels. */
  topPx: number;
  /** Height of the lower spacer in pixels. */
  botPx: number;
  /** The CLAMPED scroll position — the caller writes it back. */
  scrollTop: number;
}

/**
 * Which slice of the list belongs in the DOM?
 *
 * Pure, without DOM — the test environment has no layout, and this calculation is the
 * only place where an error stays silent: a wrong slice looks
 * like "something slipped", not like an error.
 *
 * The clamp (`scrollTop` above the content height) is scar 1 from the old
 * drawing path: after a dimension switch or a filter shrink the old
 * position sits above the new height, the browser has not clamped yet, and without
 * correction the window would consist of two spacers and no row.
 *
 * `headH`: the height of the header row that sits IN FLOW above the `<tbody>`
 * (fix round 2, finding 3). As soon as an attribute column is chosen, the
 * container scrolls further by this height than the row block is tall — without it the
 * calculation clamped too short at the bottom end, the caller wrote the too-small value
 * back, and the view visibly snapped back at the end of the list on every scroll;
 * the last row was not fully reachable. It is MEASURED, not
 * set — the same reasoning as for the row height. `0` (no header row)
 * calculates bit-identically to before this parameter.
 */
export function viewportRange(
  total: number, scrollTop: number, viewH: number, rowH: number, buffer: number,
  headH = 0,
): Slice {
  if (total <= 0) {
    return { start: 0, end: 0, topPx: 0, botPx: 0, scrollTop: 0 };
  }

  const h = rowH > 0 ? rowH : ROW_H_FALLBACK;
  const view = viewH > 0 ? viewH : 800;
  const head = headH > 0 ? headH : 0;
  const contentH = total * h;
  // The container scrolls over the header row AND the row block.
  const maxScrollTop = Math.max(0, contentH + head - view);
  const clampedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
  // The rows sit in the `<tbody>`, i.e. BELOW the header row: their positions
  // are calculated against the position within the body, not against that of the
  // container. As long as the header row is still fully visible, that is 0.
  const inBody = Math.max(0, clampedScrollTop - head);

  // The epsilon stands ONLY here, and it is not superstition: `2254.7 / 22.547`
  // gives 99.99999999999999 in IEEE instead of 100, and `floor` turned that into one
  // row too few. With `floor` it works in one direction only — it lifts a
  // slightly too small value to the integer, but can never lift an exact integer
  // above the next. With `ceil` that does NOT hold: there the same
  // epsilon would turn a window that divides evenly (600 / 25 = 24) into one row too
  // many. That is why it is not used there.
  const start = Math.max(0, Math.floor(inBody / h + 1e-9) - buffer);
  const end = Math.min(total, Math.ceil((inBody + view) / h) + buffer);

  const topPx = start * h;
  const botPx = (total - end) * h;

  return { start, end, topPx, botPx, scrollTop: clampedScrollTop };
}

/**
 * A spacer row.
 *
 * NO `data-idx`: click (`viewPath.ts#bindClick`), context menu
 * (`viewCtx.ts`) and dragging (`viewDrag.ts`) hang on it. Without the attribute all three
 * automatically act only on real rows — the spacer does not have to know anything about it.
 *
 * The CSS rules for `.vspacer` live in `dimensionBrowserCss.ts` and survived
 * the teardown of the old drawing path.
 *
 * `columnCount`: how many attribute columns exist in addition to the name column.
 * The `colspan` must span the name column PLUS all attribute columns,
 * otherwise the table layout tips over as soon as columns exist.
 */
export function spacerHtml(heightPx: number, columnCount = 0): string {
  if (!(heightPx > 0)) {
    return '';
  }
  return '<tr class="vspacer" role="presentation" aria-hidden="true">'
    + '<td colspan="' + (1 + columnCount) + '" style="height:' + heightPx + 'px;padding:0;border:0"></td></tr>';
}

/**
 * The header row. Empty as long as no column is chosen — the `<thead>` was
 * always empty until now, and without columns it should stay that way.
 *
 * The header cell is already styled as a STICKY header row
 * (`.dim-table thead th`, `position: sticky`) — it stays in place while
 * scrolling, without anything being needed here.
 */
export function attrHeadHtml(
  columns: readonly string[], width: (name: string) => number,
  label: (name: string) => string = (n) => n,
): string {
  if (!columns.length) { return ''; }
  // The handle still carries the RAW name (`data-col`) — it is the
  // key of the width store. Only the visible text is translated,
  // otherwise dragging on a placeholder column would write the width away under
  // "Index" instead of under the NUL name.
  return '<tr role="row"><th scope="col"></th>'
    + columns.map((c) =>
      '<th scope="col" style="width:' + width(c) + 'px">'
      + '<span class="vw-col-name">' + esc(label(c)) + '</span>'
      + '<span class="vw-col-grip" data-col="' + esc(c) + '"></span></th>').join('')
    + '</tr>';
}

/**
 * The value of ONE column in ONE row.
 *
 * The two placeholder columns do not read from `attrs` but from the
 * answer's own fields — they are not attributes (see
 * `attrColumns.ts#COL_INDEX`).
 *
 * `== null` instead of `||`: index and weight are both legitimately 0 (a root
 * carries weight 0, measured live). An `||` would turn that into an empty cell
 * and thereby a false statement.
 */
export function columnValue(row: DisplayRow, column: string): string {
  if (column === COL_INDEX) { return row.index == null ? '' : String(row.index); }
  if (column === COL_WEIGHT) { return row.weight == null ? '' : String(row.weight); }
  return (row.attrs && row.attrs[column]) || '';
}

/** The name column gets no narrower, no matter how many attribute columns exist. */
export const NAME_MIN_PX = 240;

/**
 * The minimum width of the TABLE — empty as long as no attribute column exists.
 *
 * Fix round 2, finding 4: under `table-layout: fixed` the name column carries
 * NO width of its own (see `colgroupHtml`) and thus gets whatever is left over.
 * Without a cap that is zero given enough attribute columns — the column would be
 * squeezed together. A minimum width ON THE COLUMN does not work: under
 * `fixed` only `width` counts there, and a fixed value would come back as a
 * proportional distribution of the surplus and thereby bend the attribute widths
 * dragged by the user. The minimum width on the table, by contrast, permits
 * both: if everything fits, the table stays 100 % wide and the name column
 * takes the rest; if it does not fit, the table overhangs the container and
 * `#table-container { overflow: auto }` scrolls horizontally — as before.
 */
export function tableMinWidth(
  columns: readonly string[], width: (name: string) => number,
): string {
  if (!columns.length) { return ''; }
  let total = 0;
  for (const c of columns) { total += width(c); }
  return (NAME_MIN_PX + total) + 'px';
}

/**
 * The widths live OUTSIDE the rows.
 *
 * The drawer rebuilds rows on every scroll; if the width were in the
 * cell, it would have to write it along every time, and an adjustment would touch
 * 10,000 cells instead of one `<col>`.
 *
 * The name column gets NO width: under `table-layout: fixed` a
 * column without a value takes the rest.
 */
export function colgroupHtml(
  columns: readonly string[], width: (name: string) => number,
): string {
  return '<colgroup><col>'
    + columns.map((c) => '<col style="width:' + width(c) + 'px">').join('')
    + '</colgroup>';
}
