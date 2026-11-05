/**
 * Pure helpers for the transaction log window: time window, row key, and
 * the MDX expression for jumping into the Cube Viewer. No `vscode`, no
 * network — so it can be tested in isolation.
 */
import { escapeMdx } from '../utils/odataKey';

/**
 * The offered windows in hours. A window is mandatory (see the header of
 * `tm1Rest/transactionLogApi.ts`), so there is no "everything" option here.
 */
export const WINDOW_HOURS = [1, 8, 24, 72, 168, 720] as const;

/** The offered row counts. Measured: 10,000 rows = 2.79 MB in 64 ms. */
export const TOP_OPTIONS = [100, 500, 1000, 5000, 10000] as const;
export const MAX_TOP = Math.max(...TOP_OPTIONS);

/** ISO-8601 in the form TM1 expects in `$filter`: seconds, `Z`, no milliseconds. */
export function toOdataInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Lower window bound from an hour count, computed from `now`. */
export function windowStart(hours: number, now: Date = new Date()): string {
  const h = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return toOdataInstant(new Date(now.getTime() - h * 3600_000));
}

/**
 * MDX pointing at exactly the cell a log row names.
 *
 * The first two dimensions go onto the axes, all the others into the
 * `WHERE` part — the same split the Cube Viewer shows when opening a
 * view. Without an axis, the expression would not be a grid.
 *
 * Returns `null` when the dimension list and the tuple do not match
 * (different length, empty names). In that case, the mapping from
 * element to dimension would be a guess, and guessing does not happen
 * here: the caller opens the cube without an expression and says so.
 */
export function buildCellMdx(cube: string, dims: string[], tuple: string[]): string | null {
  if (!cube || dims.length === 0 || dims.length !== tuple.length) { return null; }
  if (dims.some(d => !d) || tuple.some(t => !t)) { return null; }
  const member = (dim: string, elem: string) => `[${escapeMdx(dim)}].[${escapeMdx(elem)}]`;
  const axes = [`{${member(dims[0], tuple[0])}} ON 0`];
  if (dims.length > 1) { axes.push(`{${member(dims[1], tuple[1])}} ON 1`); }
  const rest = dims.slice(2).map((d, i) => member(d, tuple[i + 2]));
  return `SELECT ${axes.join(', ')} FROM [${escapeMdx(cube)}]`
    + (rest.length > 0 ? ` WHERE (${rest.join(', ')})` : '');
}

/** What the search form says about the time window. */
export interface WindowInput {
  /** A `datetime-local` value, i.e. local time without a zone (`2026-09-22T08:30`). */
  fromLocal?: string;
  toLocal?: string;
  /** The quick-pick in hours, when no bound was typed. */
  hours?: number;
}

export interface ResolvedWindow {
  fromIso: string;
  toIso?: string;
  /** Length of the window in hours — the form warns from a week upward. */
  spanHours: number;
}

/** Local time from a `datetime-local` field, or `null` if unusable. */
function parseLocal(v: string | undefined): Date | null {
  if (!v) { return null; }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolves the search form's inputs into the two bounds that `$filter`
 * needs.
 *
 * The typed bounds take precedence over the quick-pick; if the lower one
 * is missing, the quick-pick computes it. **Swapped bounds are exchanged,
 * not rejected**: "from today to yesterday" would otherwise return zero
 * rows, and zero rows already mean "nothing changed, or not logged" in
 * this window — a third silent meaning would be one too many.
 */
export function resolveWindow(inp: WindowInput, now: Date = new Date()): ResolvedWindow {
  let from = parseLocal(inp.fromLocal);
  let to = parseLocal(inp.toLocal);
  if (from && to && from.getTime() > to.getTime()) { [from, to] = [to, from]; }
  const fromIso = from ? toOdataInstant(from) : windowStart(Number(inp.hours), now);
  const fromMs = from ? from.getTime() : new Date(fromIso).getTime();
  const endMs = to ? to.getTime() : now.getTime();
  return {
    fromIso,
    toIso: to ? toOdataInstant(to) : undefined,
    spanHours: Math.max(0, (endMs - fromMs) / 3600_000),
  };
}

/** From here, the form warns about the load: one week. */
export const WARN_SPAN_HOURS = 168;

// ── Undo ─────────────────────────────────────────────────────────────────────
//
// TM1 can undo a change set itself (`tm1.UndoChangeSet`), but only if the
// writing client opened it with `BeginChangeSet`. On the test server, none
// of 28,809 rows carried a `ChangeSetID` (measured 2026-09-23). "Back Out"
// in Architect is therefore, here too, what it says: writing the
// `OldValue` back into the cell. The write-back itself appears again as a
// row in the log (also measured).

/** A row, as far as rolling it back needs it. */
export interface UndoEntry {
  TimeStamp?: string;
  Cube?: string;
  Tuple?: string[];
  OldValue?: string | number | null;
  NewValue?: string | number | null;
}

/** A cell's key: cube + tuple. */
export function cellKey(cube: string, tuple: string[]): string {
  return [cube, ...tuple].join('\u001f');
}

/**
 * Equality of cell values across the log and the cellset. Empty (`null`,
 * `''`) and `0` are the same for numeric cells: the log writes `null` for
 * an empty cell, the cellset returns `0`.
 */
export function sameCellValue(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : v);
  const x = n(a);
  const y = n(b);
  if (x === null || y === null) { return (x ?? 0) === (y ?? 0) || (x ?? '') === (y ?? ''); }
  if (typeof x === 'number' || typeof y === 'number') { return Number(x) === Number(y); }
  return String(x) === String(y);
}

export interface CellUndoPlan {
  /**
   * The value that should go back into the cell (log notation, `null` =
   * empty). `undefined`: the order of the oldest rows cannot be determined.
   */
  target: string | number | null | undefined;
  /**
   * The cell is not at the state that the chosen rows left behind: it was
   * changed again afterward (or in between). Writing back would then also
   * overwrite that unrelated change.
   */
  conflict: boolean;
}

/**
 * Plans the rollback of ONE cell from its current value and the chosen
 * rows for it.
 *
 * The order does NOT come from the timestamp alone: TM1 writes several
 * changes of the same cell in the same second (measured: three rows around
 * 19:10:39), and `ID` is not a key. Instead, the chain is walked backward
 * from the current value — the row whose `NewValue` matches the current
 * value yields the value before it. This search is limited to the most
 * recent second still open: a match in an older row must not skip over a
 * newer, non-matching one. If rows remain, the chain is broken: a
 * conflict, and the target is the `OldValue` of the chronologically first
 * chosen row. If that row is not unique within its second (a value cycle,
 * two starting points), `target` is `undefined` — no guessing happens
 * here.
 */
export function planCellUndo(current: unknown, entries: UndoEntry[]): CellUndoPlan {
  const ts = (e: UndoEntry) => e.TimeStamp ?? '';
  // Newest first, so that among equal values the newest row wins.
  const rest = [...entries].sort((a, b) => ts(b).localeCompare(ts(a)));
  let value: unknown = current;
  while (rest.length > 0) {
    const i = rest.findIndex(e => ts(e) === ts(rest[0]) && sameCellValue(e.NewValue, value));
    if (i < 0) { break; }
    value = rest[i].OldValue ?? null;
    rest.splice(i, 1);
  }
  if (rest.length === 0) { return { target: value as string | number | null, conflict: false }; }
  const first = rest.filter(e => ts(e) === ts(rest[rest.length - 1]));
  const starts = first.filter(e => !first.some(o => o !== e && sameCellValue(o.NewValue, e.OldValue)));
  return { target: starts.length === 1 ? starts[0].OldValue ?? null : undefined, conflict: true };
}

/**
 * The value that actually gets written. Empty means `0` for a numeric
 * cell, `''` for a text cell — which one it is, is told by the current
 * value.
 */
export function undoWireValue(target: string | number | null, current: unknown): string | number {
  if (target === null || target === '') { return typeof current === 'string' ? '' : 0; }
  return target;
}

/**
 * MDX that reads the current values of several cells of ONE cube at once:
 * one tuple per cell on axis 0, in the same order as `tuples`. `null` on a
 * length mismatch — then the mapping from element to dimension would be a
 * guess.
 */
export function buildCellsReadMdx(cube: string, dims: string[], tuples: string[][]): string | null {
  if (!cube || dims.length === 0 || tuples.length === 0) { return null; }
  if (tuples.some(t => t.length !== dims.length || t.some(e => !e))) { return null; }
  const tup = (t: string[]) => `(${t.map((e, i) => `[${escapeMdx(dims[i])}].[${escapeMdx(e)}]`).join(', ')})`;
  return `SELECT {${tuples.map(tup).join(', ')}} ON 0 FROM [${escapeMdx(cube)}]`;
}

/**
 * Brings rows of the same cell within the same second into their real
 * order (newest first). Input as delivered by the server: `TimeStamp
 * desc`.
 *
 * TM1 delivers such rows in an arbitrary sequence even with `$orderby`
 * (measured 2026-09-23), and `ID` is not a key. The order only lives in
 * the value chain: a row's `OldValue` is the previous row's `NewValue`.
 * The chain is anchored at the next NEWER row of the same cell (its
 * `OldValue` is what the group's newest row left behind) or, if there is
 * none, at the next OLDER one (its `NewValue` is what the oldest one
 * found). A back-and-forth like 510→500459→510 can only be resolved this
 * way. If the chain does not fully resolve, the server order is kept — no
 * guessing happens here.
 */
export function orderSameSecond<T extends UndoEntry>(rows: T[]): T[] {
  const key = (e: T) => cellKey(e.Cube ?? '', e.Tuple ?? []);
  const out: T[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].TimeStamp === rows[i].TimeStamp) { j++; }
    const group = rows.slice(i, j);
    const done = new Set<T>();
    for (const first of group) {
      if (done.has(first)) { continue; }
      const k = key(first);
      const same = group.filter(e => key(e) === k);
      same.forEach(e => done.add(e));
      if (same.length === 1) { out.push(first); continue; }
      const newer = [...out].reverse().find(e => key(e) === k);
      const older = rows.slice(j).find(e => key(e) === k);
      out.push(...(chain(same, newer, older) ?? same));
    }
    i = j;
  }
  return out;
}

/** The group as a gap-free chain, newest first — or `null` if it does not resolve. */
function chain<T extends UndoEntry>(same: T[], newer?: T, older?: T): T[] | null {
  const walk = (start: unknown, from: 'top' | 'bottom'): T[] | null => {
    const rest = [...same];
    const res: T[] = [];
    let v = start;
    while (rest.length > 0) {
      const idx = rest.findIndex(e => sameCellValue(from === 'top' ? e.NewValue : e.OldValue, v));
      if (idx < 0) { return null; }
      const [e] = rest.splice(idx, 1);
      res.push(e);
      v = from === 'top' ? e.OldValue : e.NewValue;
    }
    return from === 'top' ? res : res.reverse();
  };
  if (newer) { const r = walk(newer.OldValue ?? null, 'top'); if (r) { return r; } }
  if (older) { const r = walk(older.NewValue ?? null, 'bottom'); if (r) { return r; } }
  // Without an anchor: the row whose NewValue no other row found as its OldValue is the newest.
  const tops = same.filter(e => !same.some(o => o !== e && sameCellValue(o.OldValue, e.NewValue)));
  return tops.length === 1 ? walk(tops[0].NewValue ?? null, 'top') : null;
}
