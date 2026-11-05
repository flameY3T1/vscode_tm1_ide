/**
 * Pure helpers for the cube-viewer grid renderer.
 *
 * Extracted from `grid.ts` for unit-testability. No DOM, no module state.
 * Hebel 17 — Iter 2.
 */

import { buildCoordinates, pickDefinitionForCell } from './pureBridge';
import type { CellFlag, MatrixData } from './state';

export {};

/**
 * Decide whether a TM1 cell value should be treated as "has data" for the
 * suppress-empty filter. Non-numeric strings always count as data; numeric
 * `0` (with comma/dot variants stripped) counts as empty; `null`/`undefined`/`''`
 * are empty.
 */
export function hasData(val: string | undefined | null): boolean {
  if (val == null || val === '') { return false; }
  const num = parseFloat(String(val).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return isNaN(num) || num !== 0; // non-numeric strings always count as data
}

/**
 * Like `hasCollapsedAncestor` but walks ALL parent paths (the multi-parent DAG),
 * not just the primary chain. A member displayed under a consolidation that is
 * not its *first* parent still hides when that consolidation collapses — the
 * first-parent chain misses those (in real TM1 models most edges are not the
 * child's first parent). `allParents` maps child → every direct parent.
 * Cycle-safe.
 *
 * `parentOf` (the `first` map) is the MANDATORY fallback now that the maps
 * arrive trimmed: `all` only carries MULTI-PARENT elements, because a
 * single-parent entry there would be a pure repetition of `first`
 * (`axisMetaScopePure.ts`). Without the fallback the ascent breaks off at the
 * first single-parent link — and since that is the normal case, collapsing
 * would hide practically nothing.
 */
export function hasCollapsedAncestorDag(
  elemName: string,
  allParents: Record<string, string[]> | undefined | null,
  collapsed: Record<string, boolean> | undefined | null,
  parentOf?: Record<string, string> | null,
): boolean {
  if (!collapsed || !allParents) { return false; }
  const upsOf = (n: string): string[] => {
    const a = allParents[n];
    if (a && a.length > 0) { return a; }
    const f = parentOf?.[n];
    return f === undefined ? [] : [f];
  };
  const seen = new Set<string>();
  const stack: string[] = [...upsOf(elemName)];
  let guard = 0;
  while (stack.length > 0 && guard++ < 100000) {
    const p = stack.pop() as string;
    if (seen.has(p)) { continue; }
    seen.add(p);
    if (collapsed[p]) { return true; }
    for (const u of upsOf(p)) { if (!seen.has(u)) { stack.push(u); } }
  }
  return false;
}

/**
 * Insert `children` into `base` directly AFTER `elem`, so an expanded row's
 * children render under it — never appended as a block at the end of the axis.
 *
 * - `elem` absent from `base` → appended first, then its children after it.
 * - Children already sitting BELOW `elem` are skipped (no duplicates, no
 *   reorder). Position matters, mirroring `hasCandidateBelow`: a child the user
 *   dragged ABOVE `elem` in the Dimension Browser has left that block, so
 *   expanding `elem` must list it again underneath — the member then legitimately
 *   appears twice on the axis (live bug report 2026-08-01). TM1 11.8 renders such
 *   an axis fine, both via a NativeView subset and via an MDX set (live-probed).
 * - Returns a new array; `base` is not mutated.
 *
 * Shared by both drill-expand paths in `grid.ts` (server-filter and
 * local/focus). The local path used to do `[...base, elem, ...children]`, which
 * dropped the children at the very bottom of the dimension instead of under the
 * parent.
 */
export function insertChildrenAfterParent(
  base: readonly string[],
  elem: string,
  children: readonly string[],
  parentIdx?: number,
): string[] {
  const withParent = base.includes(elem) ? base.slice() : [...base, elem];
  const pIdx = resolveParentIdx(withParent, elem, parentIdx);
  const end = blockEnd(withParent, elem, pIdx);
  // Only the addressed block counts as "already below" — a child hanging under
  // a LATER occurrence of the same parent belongs to that block and must still
  // be listed here.
  const below = new Set(withParent.slice(pIdx + 1, end));
  const toAdd = children.filter((c) => !below.has(c));
  return [...withParent.slice(0, pIdx + 1), ...toAdd, ...withParent.slice(pIdx + 1)];
}

/**
 * Which occurrence of `parent` a block decision applies to.
 *
 * `parentIdx` is the caller's index into `names`; `grid.ts` knows which
 * rendered block the user clicked and passes it through, because resolving the
 * parent by name can only ever find the FIRST occurrence — and since the
 * 2026-08-01 rework the same member may legitimately sit on an axis more than
 * once. The index is honoured only while it still points at `parent`: a stale
 * index (older render, list changed under the click) must never address a
 * foreign element. Everything else falls back to the historic by-name lookup,
 * which is also the single-occurrence case (behaviour unchanged) and the
 * "parent not in the list at all" case (-1).
 */
function resolveParentIdx(
  names: readonly string[],
  parent: string,
  parentIdx?: number,
): number {
  if (parentIdx != null && parentIdx >= 0 && names[parentIdx] === parent) { return parentIdx; }
  return names.indexOf(parent);
}

/**
 * End (exclusive) of the block owned by the occurrence at `pIdx`: the next
 * occurrence of the same `parent`, or the end of the list.
 *
 * TM1 11.8 renders an axis carrying the same member twice fine, both via a
 * NativeView subset and via an MDX set (live-probed 2026-08-01). Positionally
 * each occurrence owns exactly the run up to the next one — without that upper
 * bound the FIRST block would claim the second block's children as its own.
 * With a single occurrence the bound is the list end, i.e. the old behaviour.
 */
function blockEnd(names: readonly string[], parent: string, pIdx: number): number {
  if (pIdx < 0) { return names.length; }
  const next = names.indexOf(parent, pIdx + 1);
  return next < 0 ? names.length : next;
}

/**
 * True if any of `candidates` sits in `names` inside the block of the addressed
 * occurrence of `parent` (see `resolveParentIdx` / `blockEnd`). Position matters
 * because the Dimension Browser lets the user drag a member out of its
 * consolidation's block — a child parked ABOVE its parent is no longer displayed
 * under it and must not count as "hanging below" (live bug report 2026-08-01).
 * A `parent` that is not in the list at all keeps the old name-set semantics:
 * every position counts as below.
 */
export function hasCandidateBelow(
  names: readonly string[],
  parent: string,
  candidates: readonly string[],
  parentIdx?: number,
): boolean {
  if (candidates.length === 0) { return false; }
  const pIdx = resolveParentIdx(names, parent, parentIdx);
  const end = blockEnd(names, parent, pIdx);
  const set = new Set(candidates);
  return names.some((n, i) => (pIdx < 0 || (i > pIdx && i < end)) && set.has(n));
}

/** `hasCandidateBelow` for the toggle glyph: is an immediate child still under `parent`? */
export function hasChildBelow(
  names: readonly string[],
  parent: string,
  immediate: readonly string[],
  parentIdx?: number,
): boolean {
  return hasCandidateBelow(names, parent, immediate, parentIdx);
}

/**
 * THE collapse answer of the grid: collapsed ⇔ no direct child remains under
 * this occurrence.
 *
 * Previously `grid.ts#_toggleHtml` answered the same question three times —
 * from the visible children (`localFocus`), from the filter list
 * (`kind:'elements'`) and from the `state.collapsed` marker (everything else).
 * The marker is the outlier: it is the hiding MECHANISM of the unfiltered
 * case, but it only qualifies as an answer there. Since the filter chip
 * (2026-08-20) introduced a selection of kind `kind:'expression'`, this case
 * fell into the marker branch and lied: the axis comes from a `DRILLUPMEMBER`,
 * so it has no children, yet the empty marker still reported "expanded".
 *
 * This function reads what IS THERE instead. That is correct in all four
 * cases, because every hiding mechanism ends up causing exactly that: no child
 * row below. `seq` is the displayed name sequence of the axis dimension
 * (block form, cf. `axisBaseFromTuples`), `ordinal` the block ordinal of the
 * clicked occurrence.
 *
 * `ordinal < 0` or an ordinal that `seq` does not provide addresses the FIRST
 * occurrence (`resolveParentIdx` falls back to `indexOf`); if `elem` is not in
 * `seq` at all, every position counts as "below" — the same non-positional
 * reading that the focus branch always gave before.
 */
export function isCollapsedByDisplay(
  seq: readonly string[],
  elem: string,
  immediate: readonly string[],
  ordinal: number,
): boolean {
  const idx = ordinal >= 0 ? nthOccurrenceIndex(seq, elem, ordinal) : -1;
  return !hasChildBelow(seq, elem, immediate, idx >= 0 ? idx : undefined);
}

/**
 * Index in `names` of the `ordinal`-th (0-based) occurrence of `name`, or -1
 * when there are fewer. Turns the rendered block ordinal that `grid.ts` counts
 * on the axis (`computeBlockOrdinals`) into the names-array index the block
 * helpers above expect.
 */
export function nthOccurrenceIndex(
  names: readonly string[],
  name: string,
  ordinal: number,
): number {
  if (ordinal < 0) { return -1; }
  let seen = 0;
  for (let i = 0; i < names.length; i++) {
    if (names[i] === name) {
      if (seen === ordinal) { return i; }
      seen++;
    }
  }
  return -1;
}

/**
 * Per axis position, the 0-based ordinal of the rendered block that position
 * belongs to for axis dim `di`.
 *
 * A block starts wherever the renderer emits a fresh label+toggle, i.e. when
 * `tuples[i].slice(0, di + 1)` differs from the previous row's. The counter
 * resets whenever the higher-dim prefix changes: on a cross-join axis dim `di`
 * replays its own element list once per outer block, so "the first X under B"
 * is still X's occurrence 0 in that dim's list, not a second one.
 */
export function computeBlockOrdinals(
  tuples: readonly (readonly string[])[],
  di: number,
): number[] {
  const out: number[] = new Array<number>(tuples.length).fill(0);
  const counts = new Map<string, number>();
  let cur = 0;
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i] ?? [];
    const prev = i > 0 ? (tuples[i - 1] ?? []) : null;
    let prefixChanged = true;
    if (prev) {
      prefixChanged = false;
      for (let k = 0; k < di; k++) {
        if (t[k] !== prev[k]) { prefixChanged = true; break; }
      }
    }
    if (prefixChanged) { counts.clear(); }
    if (prefixChanged || !prev || t[di] !== prev[di]) {
      const name = t[di] ?? '';
      cur = counts.get(name) ?? 0;
      counts.set(name, cur + 1);
    }
    out[i] = cur;
  }
  return out;
}

/**
 * The name sequence that a loaded axis holds for dimension `di` — or `null`
 * when the axis cannot be explained as such a sequence.
 *
 * Needed because a freshly opened view has NO explicit element selection: its
 * axis comes from the stored subsets. Without reading it off the matrix,
 * "Keep only" would fall back to the server the first time and would only work
 * locally after some reload had left a selection behind.
 *
 * What is counted is what `computeBlockOrdinals` counts as a block: the same
 * outer prefix and the same name = one block. If the sequence repeats the same
 * way in EVERY outer block, it is the answer — the cross-product case.
 *
 * It does NOT have to be identical, though. With empty-row suppression a
 * different combination is missing per outer block, so the blocks are never
 * equal, and demanding equality took the base list away from every INNER axis
 * dimension: the outermost kept it because its prefix is empty and there is
 * only ONE block to compare (click test flameY3T1 2026-08-08: "only the first
 * dimension is fast"). Across gaps a common ordering is enough — the order of
 * first appearance over the whole axis — as long as every block is a
 * subsequence of it. This check lets gaps through and still rejects a real
 * CONTRADICTION (X before Y here, Y before X there, such as an MDX axis).
 *
 * A name that appears twice in ONE block (an element under two parents) is not
 * carried across gaps — exactly the case the block ordinals exist for. Across
 * unequal blocks the intended occurrence could no longer be addressed safely,
 * and an invented base list would hide the wrong row. If the blocks are equal,
 * the first branch still applies, which continues to support duplicates.
 */
export function axisBaseFromTuples(
  tuples: ReadonlyArray<ReadonlyArray<string>>,
  di: number,
): string[] | null {
  if (tuples.length === 0) { return null; }
  const groups = new Map<string, string[]>();
  // Order of first appearance over the WHOLE axis — the same order in which
  // the rows stand and in which a selection comes back ("Keep only" removes
  // things, it does not re-sort).
  const order: string[] = [];
  const seenGlobal = new Set<string>();
  for (const t of tuples) {
    const prefix = t.slice(0, di).join('\u0000');
    let seq = groups.get(prefix);
    if (!seq) { seq = []; groups.set(prefix, seq); }
    const name = t[di] ?? '';
    if (seq.length === 0 || seq[seq.length - 1] !== name) { seq.push(name); }
    if (!seenGlobal.has(name)) { seenGlobal.add(name); order.push(name); }
  }
  const seqs = Array.from(groups.values());
  const first = seqs[0];
  if (seqs.every((s) => s.length === first.length && s.every((n, i) => n === first[i]))) {
    return first;
  }
  // Unequal blocks: a common ordering supports them as long as every block is
  // a subsequence of it and none lists a name twice.
  for (const seq of seqs) {
    if (new Set(seq).size !== seq.length) { return null; }
    if (!isSubsequenceOf(seq, order)) { return null; }
  }
  return order;
}

/** What `axisBaseNamesFromMatrix` needs from a matrix — deliberately
 *  narrower than `MatrixData`, so that this module stays free of its type. */
export interface AxisBaseSource {
  rowDims?: string[];
  colDims?: string[];
  rowTuples?: string[][];
  colTuples?: string[][];
  rowElements?: string[];
  colElements?: string[];
}

/**
 * The base list of every axis dimension of a loaded matrix.
 *
 * Two paths set a matrix: the server's answer and the local pivot. Both need
 * the same derivation — if one of them skipped it, "Keep only" would retain
 * the base lists of the PREVIOUS axis layout and thereby hide the wrong rows.
 * Dimensions whose axis cannot be explained as a name sequence are missing
 * from the map; the caller falls back to the server for them (see
 * `axisBaseFromTuples`).
 */
export function axisBaseNamesFromMatrix(m: AxisBaseSource): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const note = (dims: string[] | undefined, tuples: string[][]): void => {
    (dims ?? []).forEach((d, di) => {
      const base = axisBaseFromTuples(tuples, di);
      if (base) { out[d] = base; }
    });
  };
  note(m.rowDims, m.rowTuples ?? (m.rowElements ?? []).map((e) => [e]));
  note(m.colDims, m.colTuples ?? (m.colElements ?? []).map((e) => [e]));
  return out;
}

/**
 * Is every entry of `current` also present in `base`, in order?
 *
 * This is the question "is the loaded matrix sufficient for this selection?".
 * If the answer is yes, the toggle click works without the server — when
 * collapsing, always; when re-expanding, exactly when the children had already
 * been fetched once before and were only hidden.
 */
export function isSubsequenceOf(current: readonly string[], base: readonly string[]): boolean {
  if (current.length > base.length) { return false; }
  let j = 0;
  for (const name of base) {
    if (j < current.length && current[j] === name) { j++; }
  }
  return j === current.length;
}

/** Address of a rendered block: name plus block ordinal from `computeBlockOrdinals`. */
export function occKey(name: string, ord: number): string {
  return `${name}\u0000${ord}`;
}

/**
 * The occurrences that `base` has and `current` no longer has — as
 * (name, block ordinal) keys, counted over `base`.
 *
 * This is how a collapse hides rows without asking the server: `base` is the
 * name sequence from which the loaded matrix arose, `current` the current
 * selection. The difference is derived anew on every render instead of being
 * carried forward — several collapse steps therefore compose by themselves,
 * and there is no carried state that could go wrong.
 *
 * If `current` is not a subsequence of `base`, the function returns an empty
 * set. That is the state right after an expand: the selection names things
 * that the matrix does not have yet. Until the server answers, "hide nothing"
 * is the only answer that shows nothing wrong.
 */
export function removedOccurrences(
  base: readonly string[],
  current: readonly string[],
): Set<string> {
  const out = new Set<string>();
  if (base.length === 0 || current.length > base.length) { return out; }
  const counts = new Map<string, number>();
  let j = 0;
  for (const name of base) {
    const ord = counts.get(name) ?? 0;
    counts.set(name, ord + 1);
    if (j < current.length && current[j] === name) { j++; continue; }
    out.add(occKey(name, ord));
  }
  // Not every entry of `current` could be found again in `base`, in order —
  // then the difference does not describe a collapse.
  return j === current.length ? out : new Set<string>();
}

/**
 * New server-filter element list after clicking `elem`'s toggle.
 *
 * Collapse (descendants below `elem` exist) drops exactly those descendant
 * occurrences and keeps `elem`; anything the user moved above `elem` stays put.
 * Otherwise the click means expand → the immediate children are inserted right
 * after the parent (`insertChildrenAfterParent`, which skips only children
 * already sitting below the parent, so a moved-up child reappears inside the
 * block and the member shows twice).
 */
export function toggleFilterNames(
  names: readonly string[],
  elem: string,
  immediate: readonly string[],
  allDesc: readonly string[],
  parentIdx?: number,
): string[] {
  if (!hasCandidateBelow(names, elem, allDesc, parentIdx)) {
    return insertChildrenAfterParent(names, elem, immediate, parentIdx);
  }
  const pIdx = resolveParentIdx(names, elem, parentIdx);
  const end = blockEnd(names, elem, pIdx);
  const descSet = new Set(allDesc);
  const kept = names.filter((n, i) => !((pIdx < 0 || (i > pIdx && i < end)) && descSet.has(n)));
  if (!kept.includes(elem)) { kept.push(elem); }
  return kept;
}

/**
 * Does this cell carry a readable picklist? The grid needs the definition only
 * for that — the values are fetched only by the editor (architecture reason,
 * see `picklistPure.ts`: a `dimension:` definition stays raw so that a
 * 100k-element dimension does not end up in the open payload).
 *
 * Since task 15 the arrow knows only the two FLAT maps: attributes per
 * dimension and the map read from the rule text of the control cube (1 ms per
 * cube). It deliberately does NOT know the individually requested cell
 * definitions — those would only be available with a query over the whole
 * grid, and that cost more than ten minutes when measured. Such cells
 * therefore carry no arrow, but work completely on double-click (`editor.ts`).
 *
 * Both maps may be missing; a definition that does not parse or is empty
 * counts as "no list" (TM1 then silently disables the picklist itself) —
 * otherwise the arrow would promise a dropdown that the cell never shows.
 */
export function hasPicklist(
  matrix: MatrixData, ri: number, ci: number,
  cubeDims: string[], titleAssignments: Record<string, string>,
): boolean {
  const byElement = matrix.picklistByElem ?? {};
  const byRuleElement = matrix.picklistByRuleElem ?? {};
  if (Object.keys(byElement).length === 0 && Object.keys(byRuleElement).length === 0) {
    return false;
  }
  let coordinates: string[];
  try {
    coordinates = buildCoordinates({
      cubeDims, rowDims: matrix.rowDims ?? [], colDims: matrix.colDims ?? [],
      rowTuples: matrix.rowTuples ?? [], colTuples: matrix.colTuples ?? [],
      ri, ci, titleAssignments,
    });
  } catch { return false; }
  return pickDefinitionForCell({ coordinates, cubeDims, byElement, byRuleElement }) !== null;
}

/**
 * May this cell show a picklist at all?
 *
 * A picklist selects ONE element from a list and writes its name into the
 * cell. That presupposes a cell that carries exactly one value:
 *
 * - `c` (consolidated): the value is a sum. Writing here happens by spread
 *   over the leaves below — a selected list value would have no addressee.
 *   Editing stays allowed (spread input), only the list path is dropped.
 * - `r` (rule-derived) and `u === 0` (locked): the editor does not lead there
 *   anyway.
 *
 * A missing flag means a leaf cell — the server sends nothing for it.
 */
export function cellTakesPicklist(flag: CellFlag | undefined): boolean {
  return !flag?.c && !flag?.r && flag?.u !== 0;
}
