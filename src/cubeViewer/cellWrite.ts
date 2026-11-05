import { odataErrorMessage, parseJsonSafe } from '../tm1Rest/parseRest';
import type { ODataError } from '../tm1Rest/odataTypes';
import { dimOfKey } from '../utils/hierKeyPure';

export interface CoordinateArgs {
  cubeDims: string[];
  rowDims: string[];
  colDims: string[];
  rowTuples: string[][];
  colTuples: string[][];
  ri: number;
  ci: number;
  titleAssignments: Record<string, string>;
}

/** Axis key that supplies the coordinate of cube dimension `dim`: rows, then
 *  columns, then titles. Keys are `dim` or `dim:hier` (hierKeyPure). With two
 *  hierarchies of one dimension on the grid the first one wins — right for
 *  picklist lookups; writes and spreads use `cellTarget` instead. */
function keyForDim(dim: string, a: Pick<CoordinateArgs, 'rowDims' | 'colDims' | 'titleAssignments'>): string | undefined {
  const own = (k: string) => dimOfKey(k) === dim;
  return a.rowDims.find(own) ?? a.colDims.find(own) ?? Object.keys(a.titleAssignments).find(own);
}

/** Per cube dimension the axis key its coordinate comes from; the dimension
 *  itself when nothing on the grid names it. Parallel to `buildCoordinates`,
 *  and what write/spread send as `dimensions` so the host addresses the right
 *  hierarchy. */
export function coordinateKeys(a: Pick<CoordinateArgs, 'cubeDims' | 'rowDims' | 'colDims' | 'titleAssignments'>): string[] {
  return a.cubeDims.map((dim) => keyForDim(dim, a) ?? dim);
}

/**
 * Every member that pins cell (ri, ci): one per row/column key and per title
 * key. Unlike `buildCoordinates` (one per cube dimension) this keeps a second
 * hierarchy of a dimension, so a write or spread hits exactly the displayed
 * intersection: with `[D].[D].[All]` on rows and `[D].[Alt].[GroupA]` as title,
 * dropping the title would spread into all of `All`, not just its `GroupA`
 * part (Codex review 2026-09-28, F1). TM1 takes several binds of one
 * dimension in `tm1.Update` and several hierarchies of one dimension in a
 * tuple (measured 11.8 + v12, 2026-09-28).
 */
export function cellTarget(a: CoordinateArgs): { keys: string[]; elems: string[] } {
  const rowTuple = a.rowTuples[a.ri] ?? [];
  const colTuple = a.colTuples[a.ci] ?? [];
  const keys: string[] = [];
  const elems: string[] = [];
  a.rowDims.forEach((k, i) => { keys.push(k); elems.push(rowTuple[i] ?? ''); });
  a.colDims.forEach((k, i) => { keys.push(k); elems.push(colTuple[i] ?? ''); });
  for (const [k, v] of Object.entries(a.titleAssignments)) {
    if (v && !keys.includes(k)) { keys.push(k); elems.push(v); }
  }
  for (const dim of a.cubeDims) {
    if (!keys.some((k) => dimOfKey(k) === dim)) {
      throw new Error(`Dimension '${dim}' has no value in row/column/title.`);
    }
  }
  return { keys, elems };
}

/** True when some dimension is on the grid through more than one hierarchy. */
export function namesDimTwice(keys: readonly string[]): boolean {
  const dims = keys.map(dimOfKey);
  return new Set(dims).size !== dims.length;
}

/** Reorders the element names of cell (ri, ci) into the cube dimension order.
 *  Row/col dims are taken from the tuples, the rest from titleAssignments. */
export function buildCoordinates(a: CoordinateArgs): string[] {
  const rowTuple = a.rowTuples[a.ri] ?? [];
  const colTuple = a.colTuples[a.ci] ?? [];
  return a.cubeDims.map((dim) => {
    const key = keyForDim(dim, a) ?? dim;
    const rIdx = a.rowDims.indexOf(key);
    if (rIdx >= 0) return rowTuple[rIdx] ?? '';
    const cIdx = a.colDims.indexOf(key);
    if (cIdx >= 0) return colTuple[cIdx] ?? '';
    const title = a.titleAssignments[key];
    if (title === undefined || title === '') {
      throw new Error(`Dimension '${dim}' has no value in row/column/title.`);
    }
    return title;
  });
}

export type EditedValue =
  | { kind: 'empty'; payload: '' }
  | { kind: 'numeric'; payload: number }
  | { kind: 'string'; payload: string }
  | { kind: 'spreading'; payload: string };

/**
 * Removes the group character ONLY if it really forms thousands groups —
 * genuine groups of three after every occurrence, where the last segment may
 * additionally carry the decimal part. Otherwise the character belongs to the number itself (a
 * short fractional part such as `1.5`) and stays exactly as it is. The same
 * group-of-three check is already used by `decimalSepPure.ts#usesCommaDecimal`.
 */
function stripThousandsGroups(body: string, group: string, dec: string): string {
  const parts = body.split(group);
  if (parts.length < 2) { return body; }
  const decEsc = dec === '.' ? '\\.' : dec;
  const lastPattern = new RegExp(`^\\d{3}(?:${decEsc}\\d+)?$`);
  const first = parts[0];
  const last = parts[parts.length - 1];
  const mid = parts.slice(1, -1);
  const looksGrouped = /^\d{1,3}$/.test(first)
    && mid.every((p) => /^\d{3}$/.test(p))
    && lastPattern.test(last);
  return looksGrouped ? parts.join('') : body;
}

/**
 * Bring an entered or pasted number into the dot notation that
 * `parseEditedValue` recognizes as a number (`-?\d+(\.\d+)?`).
 *
 * Which notation comes in is told by the viewer's DISPLAY
 * (`state.numFmt.comma`, fed by `tm1.cubeViewer.copyDecimalSeparator`) —
 * the same source from which Ctrl+C forms its output. Without that the viewer
 * did not accept what it emits itself: in comma mode it copies `1234,50` and
 * read the same string back as TEXT.
 *
 * Spread tokens (`~`, `+N`, `*N`) come back unchanged — they are not
 * numbers, TM1 evaluates them on the server side.
 */
export function normalizeDecimal(raw: string, commaDecimal: boolean): string {
  const s = String(raw ?? '').trim();
  if (s === '') { return raw; }
  // Same detection as in `parseEditedValue`: everything that starts with an
  // operator character and is not a plain number is spreading.
  if (/^[~+*]/.test(s)) { return raw; }
  // Only touch unambiguous numbers: digits, separators, leading minus.
  if (!/^-?[\d.,]+$/.test(s)) { return raw; }

  const group = commaDecimal ? '.' : ',';
  const dec = commaDecimal ? ',' : '.';
  const sign = s.startsWith('-') ? '-' : '';
  const body = sign ? s.slice(1) : s;

  const stripped = stripThousandsGroups(body, group, dec);
  // After the (possibly omitted) removal of the grouping, at most
  // ONE decimal separator may remain; otherwise the string was not a number
  // in this notation.
  if (stripped.split(dec).length > 2) { return raw; }
  return sign + stripped.split(dec).join('.');
}

/** Splits the user input into semantic categories.
 *
 *  Inputs starting with `~`, `+` or `*` are handed back as a raw string. TM1
 *  does NOT spread them on this path (measured 2026-11-05, 11.8): `+5` writes 5,
 *  `~N`/`*N` fail with `DataSpreadFailed`. TM1's own codes (`P60`, `R+5`,
 *  `LR5`) arrive as a string too and do spread.
 *
 *  `-N` followed by a number (e.g. `-100`, `-3.14`) is NOT spreading, but a
 *  negative numeric value (numeric overwrite). This matches the TM1 Architect default
 *  for cell input. Whoever wants a subtraction has to use the TM1-specific syntax
 *  via a different operator.
 *
 *  `-` alone is `string` (not a valid number, no operation). */
export function parseEditedValue(raw: string): EditedValue {
  const s = String(raw ?? '').trim();
  if (s === '') return { kind: 'empty', payload: '' };
  if (/^[~+\-*]/.test(s) && s !== '-' && !isPlainNumber(s)) {
    return { kind: 'spreading', payload: s };
  }
  if (isPlainNumber(s)) {
    return { kind: 'numeric', payload: Number(s) };
  }
  return { kind: 'string', payload: s };
}

/**
 * Input for a STRING cell: always text, never a number, never spreading. Trimmed
 * on the outside only, like `parseEditedValue`. "01223" stays "01223" — sent as a
 * number, TM1 stored "1223" (reported 2026-09-23).
 */
export function parseStringCellValue(raw: string): EditedValue {
  const s = String(raw ?? '').trim();
  return s === '' ? { kind: 'empty', payload: '' } : { kind: 'string', payload: s };
}

function isPlainNumber(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s);
}

export type WriteErrorKind =
  | 'validation' | 'security' | 'auth' | 'server' | 'network'
  | 'spread-failed' | 'not-found' | 'picklist';

export interface WriteError {
  kind: WriteErrorKind;
  message: string;
}

/** Maps an HTTP response to a UI error category.
 *  Kinds: validation · security · auth · server · network · spread-failed · not-found · picklist
 *
 *  `hasPicklist` comes from the caller (host side, knows the cell) and
 *  decides ONLY about code 285 — numeric cells say with code 243
 *  unambiguously "ValueNotInPickList", which always counts as a picklist violation.
 *  String cells answer with the uninformative 285
 *  (`StringCellUpdateError`), which can have other causes too — we
 *  interpret it ONLY if we know of a list on this cell. */
export function classifyWriteError(
  statusCode: number, body: string, hasPicklist = false,
): WriteError {
  const message = odataErrorMessage(parseJsonSafe<ODataError>(body, {})) || `HTTP ${statusCode}`;
  if (statusCode === 0) return { kind: 'network', message: 'Network error' };
  if (statusCode === 400) {
    if (/DataSpreadFailed/i.test(body) || /DataSpreadFailed/i.test(message)) {
      return { kind: 'spread-failed', message };
    }
    if (/ValueNotInPickList/i.test(body)) { return { kind: 'picklist', message }; }
    if (hasPicklist && /StringCellUpdateError/i.test(body)) {
      return { kind: 'picklist', message };
    }
    return { kind: 'validation', message };
  }
  // The transport already retried the 401 once with fresh credentials.
  if (statusCode === 401) return { kind: 'auth', message };
  if (statusCode === 403) return { kind: 'security', message };
  if (statusCode === 404) return { kind: 'not-found', message };
  if (statusCode >= 500) return { kind: 'server', message };
  return { kind: 'server', message };
}
