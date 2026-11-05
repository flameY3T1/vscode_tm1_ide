/**
 * Display formats the user sets in the cube viewer: one format per element of
 * a dimension, applied in the grid only — the server never sees them.
 *
 * Which format a cell gets follows TM1's own priority for the element
 * attribute `Format` (measured 11.8, 2026-09-27, same for MDX and NativeView):
 * columns before rows before titles, and inside a tuple the innermost
 * dimension wins. So a display format sits where a server format would.
 */

import { nameMap } from '../utils/nameMapPure';

/** `formats[dimension][element] = format string` */
export type DisplayFormats = Record<string, Record<string, string>>;

export interface CellContext {
  colDims: readonly string[];
  colTuple: readonly string[];
  rowDims: readonly string[];
  rowTuple: readonly string[];
  titles: Readonly<Record<string, string>>;
}

function fromTuple(f: DisplayFormats, dims: readonly string[], tuple: readonly string[]): string | undefined {
  for (let i = Math.min(dims.length, tuple.length) - 1; i >= 0; i--) {
    const hit = f[dims[i]]?.[tuple[i]];
    if (hit) { return hit; }
  }
  return undefined;
}

export function resolveDisplayFormat(f: DisplayFormats, c: CellContext): string | undefined {
  const col = fromTuple(f, c.colDims, c.colTuple);
  if (col) { return col; }
  const row = fromTuple(f, c.rowDims, c.rowTuple);
  if (row) { return row; }
  for (const [dim, el] of Object.entries(c.titles)) {
    const hit = f[dim]?.[el];
    if (hit) { return hit; }
  }
  return undefined;
}

export function hasDisplayFormats(f: DisplayFormats): boolean {
  return Object.values(f).some((m) => Object.keys(m).length > 0);
}

/** Set or clear (`format` empty) the format of one element; returns a new map. */
export function withDisplayFormat(f: DisplayFormats, dim: string, element: string, format: string): DisplayFormats {
  // No prototype at either level (utils/nameMapPure.ts): a spread would bring it back.
  const forDim = Object.assign(nameMap<string>(), Object.prototype.hasOwnProperty.call(f, dim) ? f[dim] : undefined);
  if (format) { forDim[element] = format; } else { delete forDim[element]; }
  const out = Object.assign(nameMap<Record<string, string>>(), f, { [dim]: forDim });
  if (!Object.keys(forDim).length) { delete out[dim]; }
  return out;
}

/** Keep only well-formed entries from a restored state. */
export function sanitizeDisplayFormats(raw: unknown): DisplayFormats {
  // No prototype: out["__proto__"] would be Object.prototype and the write global.
  const out: DisplayFormats = nameMap();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return out; }
  for (const [dim, m] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) { continue; }
    for (const [el, fmt] of Object.entries(m as Record<string, unknown>)) {
      if (typeof fmt === 'string' && fmt) { (out[dim] ??= nameMap())[el] = fmt; }
    }
  }
  return out;
}
