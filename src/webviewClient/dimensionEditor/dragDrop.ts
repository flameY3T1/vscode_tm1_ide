/**
 * Drag-drop reparenting handler.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state } from './state';
import { findElement, updateDirty } from './helpers';
import { showError, showInfo } from './modals';
import { renderTree } from './tree';
import { planReparent, removeEdgeFromDraft, nextOrder, reindexChildren, occKey } from './pure';
import { moveInIndex } from './reindex';
import { getL10n, fmt } from '../_shared/l10n';

export {};

/** One dragged occurrence: element `n`ame drawn under parent `p` (null = root). */
export interface DragOcc { n: string; p: string | null; }

const L = getL10n();

let _renderDetail: () => void = () => {};
export function setDragDropRenderDetail(fn: () => void): void { _renderDetail = fn; }

type ApplyResult = 'added' | 'self' | 'cycle' | 'exists' | 'invalid';

/** Apply one reparent to draft state (no render, no modal). Returns status. */
function applyReparent(srcName: string, targetName: string): ApplyResult {
  const data = state.data;
  if (!data) { return 'invalid'; }
  const src = findElement(srcName);
  const target = findElement(targetName);
  if (!src || !target) { return 'invalid'; }
  if (src.marked === 'deleted' || target.marked === 'deleted') { return 'invalid'; }

  const plan = planReparent(data.edges || [], srcName, targetName);
  if (plan.action === 'skip') { return plan.reason; }

  if (target.type !== 'C') target.type = 'C';
  if (plan.action === 'restore') {
    const del = (data.edges || []).find(
      (e) => e.parent === targetName && e.child === srcName && e.marked === 'deleted',
    );
    if (del) del.marked = 'clean';
  } else {
    data.edges.push({ parent: targetName, child: srcName, weight: 1, marked: 'new', order: nextOrder(data.edges, targetName) });
  }
  data.dirty = true;
  return 'added';
}

export function handleDrop(srcName: string, targetName: string): void {
  const res = applyReparent(srcName, targetName);
  if (res === 'cycle') {
    showError(fmt(L, 'cycleError', targetName, srcName));
  } else if (res === 'exists') {
    showInfo(fmt(L, 'alreadyChildOf', srcName, targetName));
  }
  if (res === 'added') { renderTree(); _renderDetail(); updateDirty(); }
}

export function handleDropMany(srcNames: string[], targetName: string): void {
  let added = 0;
  const skipped: string[] = [];
  for (const srcName of srcNames) {
    const res = applyReparent(srcName, targetName);
    if (res === 'added') { added++; }
    else if (res === 'cycle') { skipped.push(srcName + ' (' + L.skipCycle + ')'); }
    else if (res === 'exists') { skipped.push(srcName + ' (' + L.skipAlreadyChild + ')'); }
    // 'self' / 'invalid' silently ignored
  }
  if (added > 0) { renderTree(); _renderDetail(); updateDirty(); }
  if (skipped.length > 0) {
    showInfo(fmt(L, 'dropInsertedSkipped', added, skipped.join(', ')));
  } else if (added > 0) {
    showInfo(fmt(L, 'dropInsertedUnder', added, targetName));
  }
}

type MoveResult = 'moved' | 'noop' | 'self' | 'cycle' | 'invalid';

/** Live children of `parent`, in current component order. */
function liveChildrenOrdered(parent: string): string[] {
  return (state.data?.edges || [])
    .filter(e => e.parent === parent && e.marked !== 'deleted')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(e => e.child);
}

/**
 * Move/reposition one occurrence under `newParent` (null = root, no positioning)
 * at `insertIndex` among its children. Detaches from `oldParent` unless it is the
 * same parent (then it's a pure reorder). Rewrites component order. No render.
 */
function applyMove(
  name: string,
  oldParent: string | null,
  newParent: string | null,
  insertIndex: number,
): MoveResult {
  const data = state.data;
  if (!data) { return 'invalid'; }
  const src = findElement(name);
  if (!src || src.marked === 'deleted') { return 'invalid'; }

  if (newParent) {
    if (name === newParent) { return 'self'; }
    const target = findElement(newParent);
    if (!target || target.marked === 'deleted') { return 'invalid'; }

    const alreadyLive = (data.edges || []).some(
      (e) => e.parent === newParent && e.child === name && e.marked !== 'deleted',
    );
    if (!alreadyLive) {
      const plan = planReparent(data.edges || [], name, newParent);
      if (plan.action === 'skip' && plan.reason === 'cycle') { return 'cycle'; }
      if (plan.action === 'skip' && plan.reason === 'self') { return 'self'; }
      if (target.type !== 'C') {
        target.type = 'C';
        if (target.marked === 'clean') { target.marked = 'changed'; }
      }
      if (plan.action === 'restore') {
        const del = (data.edges || []).find(
          (e) => e.parent === newParent && e.child === name && e.marked === 'deleted',
        );
        if (del) { del.marked = 'clean'; }
      } else {
        data.edges.push({ parent: newParent, child: name, weight: 1, marked: 'new', order: nextOrder(data.edges, newParent) });
      }
    }
    // True move: detach from the parent it was dragged out of.
    if (oldParent && oldParent !== newParent) { removeEdgeFromDraft(data, oldParent, name); }

    // Reposition `name` at insertIndex among newParent's children.
    const kids = liveChildrenOrdered(newParent).filter(n => n !== name);
    const idx = Math.max(0, Math.min(insertIndex, kids.length));
    kids.splice(idx, 0, name);
    reindexChildren(data, newParent, kids);
    state.collapsed.delete(newParent); // reveal the moved row
  } else {
    // Move to top level: only meaningful if it had a parent (root reorder N/A).
    if ((oldParent ?? null) === null) { return 'noop'; }
    removeEdgeFromDraft(data, oldParent as string, name);
  }
  data.dirty = true;
  return 'moved';
}

/**
 * Move dragged occurrences under `newParent` (null = top level), positioned
 * relative to the `anchor` child (the row dropped next to) — `placeAfter` puts
 * them after it. True move: each source is detached from the parent it came
 * from. Same-parent drop = pure reorder.
 */
export function handleMove(
  srcs: DragOcc[],
  newParent: string | null,
  anchor?: string,
  placeAfter?: boolean,
): void {
  let insertIndex: number;
  if (newParent && anchor) {
    const kids = liveChildrenOrdered(newParent);
    const pos = kids.indexOf(anchor);
    insertIndex = pos < 0 ? kids.length : pos + (placeAfter ? 1 : 0);
  } else {
    insertIndex = Number.MAX_SAFE_INTEGER; // append (or irrelevant for root)
  }

  let moved = 0;
  const skipped: string[] = [];
  const movedNames: string[] = [];
  for (const s of srcs) {
    const res = applyMove(s.n, s.p, newParent, insertIndex);
    if (res === 'moved') { moved++; insertIndex++; movedNames.push(s.n); }
    else if (res === 'cycle') { skipped.push(s.n + ' (' + L.skipCycle + ')'); }
    // 'noop' / 'self' / 'invalid' silently ignored
  }
  // Top level has no component list: its order is the element index. Place the
  // dragged elements next to the anchor there (a pure reorder returns 'noop'
  // above, a detach from a parent 'moved').
  if (newParent === null && anchor && state.data) {
    const names = [...new Set(srcs.map(s => s.n))].filter(n => n !== anchor && findElement(n));
    if (moveInIndex(state.data.elements, names, anchor, !!placeAfter)) {
      state.data.dirty = true;
      for (const n of names) { if (!movedNames.includes(n)) { movedNames.push(n); moved++; } }
    }
  }
  if (moved > 0) {
    // Re-point selection at the moved elements' NEW occurrences (under newParent),
    // so the tree re-highlights them and a subsequent Delete targets the live edge.
    state.selected = new Set(movedNames.map(n => occKey(newParent, n)));
    state.anchor = movedNames.length > 0 ? occKey(newParent, movedNames[movedNames.length - 1]) : null;
    renderTree(); _renderDetail(); updateDirty();
  }
  if (skipped.length > 0) {
    showInfo(fmt(L, 'dropInsertedSkipped', moved, skipped.join(', ')));
  } else if (moved > 0 && newParent) {
    showInfo(fmt(L, 'dropInsertedUnder', moved, newParent));
  }
}
