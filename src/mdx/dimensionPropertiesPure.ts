// Pure, vscode-free helpers for the per-axis `DIMENSION PROPERTIES` clause of an
// MDX SELECT. The cube viewer uses it to persist the display alias of an
// MDX view: a native view stores that choice in `Subset.Alias`, an MDX view has
// no axis subsets, so the only place that survives a save/reopen is the MDX
// text itself.
//
// Shape (measured against TM1 11.8, 2026-08-05): the clause sits inside the
// axis segment, directly before `ON <axis>`, and carries one comma-separated
// entry per dimension of that axis that shows an alias:
//
//   SELECT {[Accounts].MEMBERS} * {[Measures].MEMBERS}
//          DIMENSION PROPERTIES [Accounts].[Accounts].[ALIAS_TEXT] ON 0,
//          {[Jahre].MEMBERS} ON 1
//   FROM [Plan]
//
// A dimension without an entry falls back to `Caption` server-side, so mixed
// axes are fine and the clause disappears entirely once its last entry is gone.

import { hierKey } from '../utils/hierKeyPure';
import { escapeMdx } from '../utils/odataKey';
import { axisOf, parseSelect, splitTopLevelCommas } from './selectAxesPure';

/** `<whitespace>DIMENSION PROPERTIES<whitespace>` — the groups keep the layout. */
const DP_KEYWORD_RE = /(\s*)\bDIMENSION\s+PROPERTIES\b(\s*)/i;
/** Trailing `ON <axis>` including the whitespace that separates it from the clause. */
const AXIS_TAIL_RE = /\s*\bON\s+(?:ROWS|COLUMNS|\d+)\s*$/i;

interface AxisGroup {
  /** Segment text, commas included; `join(',')` over all groups is lossless. */
  text: string;
  /** Axis ordinal, or null for a trailing fragment that carries no `ON …`. */
  index: number | null;
}

interface SplitGroup {
  /** The set expression in front of the clause. */
  setExpr: string;
  /** Whitespace before the `DIMENSION` keyword. */
  before: string;
  /** Whitespace after the `PROPERTIES` keyword. */
  after: string;
  /** Raw, still comma-split property entries (empty when there is no clause). */
  entries: string[];
  /** The trailing `ON <axis>` verbatim. */
  tail: string;
}

/**
 * Regroup the raw comma-split segments into one entry per axis. A clause with
 * several dimensions puts top-level commas *inside* an axis segment, so the raw
 * split alone would tear an axis apart: everything up to and including the
 * segment that carries the `ON <axis>` belongs together.
 */
function _groupByAxis(segments: string[]): AxisGroup[] {
  const groups: AxisGroup[] = [];
  let buf: string[] = [];
  for (const seg of segments) {
    buf.push(seg);
    const axis = axisOf(seg);
    if (axis) {
      groups.push({ text: buf.join(','), index: axis.index });
      buf = [];
    }
  }
  if (buf.length) { groups.push({ text: buf.join(','), index: null }); }
  return groups;
}

function _splitGroup(text: string): SplitGroup {
  const mAxis = text.match(AXIS_TAIL_RE);
  const tail = mAxis ? mAxis[0] : '';
  const head = tail ? text.slice(0, text.length - tail.length) : text;
  const mDp = DP_KEYWORD_RE.exec(head);
  if (!mDp) { return { setExpr: head, before: ' ', after: ' ', entries: [], tail }; }
  return {
    setExpr: head.slice(0, mDp.index),
    before: mDp[1] || ' ',
    after: mDp[2] || ' ',
    entries: splitTopLevelCommas(head.slice(mDp.index + mDp[0].length)),
    tail,
  };
}

/**
 * Rebuild an axis segment. An empty entry list drops the clause *including* the
 * whitespace that introduced it — otherwise removing the last alias would leave
 * a dangling blank line where the clause used to be.
 */
function _joinGroup(g: SplitGroup, entries: string[]): string {
  if (!entries.length) { return g.setExpr + g.tail; }
  return g.setExpr + g.before + 'DIMENSION PROPERTIES' + g.after + entries.join(', ') + g.tail;
}

/** The unescaped names of a `[a].[b].[c]` reference, in order. */
function _entryParts(entry: string): string[] {
  const re = /\[((?:[^\]]|\]\])*)\]/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(entry)) !== null) { parts.push(m[1].replace(/\]\]/g, ']')); }
  return parts;
}

function _renderEntry(dim: string, hierarchy: string, attr: string): string {
  const names = hierarchy ? [dim, hierarchy, attr] : [dim, attr];
  return names.map((n) => `[${escapeMdx(n)}]`).join('.');
}

/** TM1 object names are case-insensitive. */
function _sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Cube viewer key of an entry (`dim` or `dim:hier`, hierKeyPure); the
 *  two-part form names the dimension's default hierarchy. */
function _entryKey(parts: string[]): string {
  return parts.length >= 3 ? hierKey(parts[0], parts[1]) : parts[0];
}

/**
 * Read the display attribute per dimension out of every axis' `DIMENSION
 * PROPERTIES` clause. Accepts both the `[Dim].[Attr]` and the
 * `[Dim].[Hier].[Attr]` form — the dimension is always the first name, the
 * attribute always the last. Keyed like the cube viewer's axes: `Dim`, or
 * `Dim:Hier` for an alternate hierarchy.
 */
export function detectDimensionProperties(mdx: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parsed = parseSelect(mdx);
  if (!parsed) { return out; }
  for (const group of _groupByAxis(parsed.segments)) {
    if (group.index === null) { continue; }
    for (const raw of _splitGroup(group.text).entries) {
      const parts = _entryParts(raw);
      if (parts.length < 2) { continue; }
      out[_entryKey(parts)] = parts[parts.length - 1];
    }
  }
  return out;
}

/**
 * Set (`attr`) or drop (`attr === null`) the display property of one dimension
 * on the axis the caller names. `axisIndex` — not a text search for the
 * dimension — decides which segment is touched, because the same dimension may
 * legitimately appear on more than one axis. Everything outside that segment
 * stays character-identical; the input is returned untouched when there is
 * nothing to do (no SELECT, unknown axis, property already as requested).
 */
export function setDimensionProperty(
  mdx: string,
  dim: string,
  hierarchy: string,
  attr: string | null,
  axisIndex: number,
): string {
  const parsed = parseSelect(mdx);
  if (!parsed) { return mdx; }
  const groups = _groupByAxis(parsed.segments);
  const gi = groups.findIndex((g) => g.index === axisIndex);
  if (gi < 0) { return mdx; }

  const split = _splitGroup(groups[gi].text);
  const wanted = attr === null ? null : _renderEntry(dim, hierarchy, attr);
  const kept: string[] = [];
  let found = false, changed = false;
  for (const raw of split.entries) {
    const trimmed = raw.trim();
    const parts = _entryParts(raw);
    // Per hierarchy: two hierarchies of one dimension may share an axis.
    if (parts.length >= 2 && _sameName(_entryKey(parts), hierKey(dim, hierarchy))) {
      found = true;
      if (wanted === null) { changed = true; continue; }
      if (trimmed !== wanted) { changed = true; }
      kept.push(wanted);
    } else if (trimmed) {
      kept.push(trimmed);
    }
  }
  if (!found) {
    if (wanted === null) { return mdx; }
    kept.push(wanted);
    changed = true;
  }
  if (!changed) { return mdx; }

  const texts = groups.map((g) => g.text);
  texts[gi] = _joinGroup(split, kept);
  return parsed.pre + texts.join(',') + parsed.post;
}
