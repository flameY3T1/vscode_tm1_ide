/**
 * Virtualized hierarchical tree renderer for dimensionEditor.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import type { EdgeDraft, ElementDraft } from '../../dimensionEditor/model';
import { state, vscode, TREE_ROW_H, TREE_BUFFER } from './state';
import { elementsList, escapeHtml, findElement, typeBadgeHtml, updateDirty } from './helpers';
import {
  typeSortKey as _pureTypeSortKey,
  compareByTypeName as _pureCompareByTypeName,
  toggleSelection,
  computeRange,
  occKey,
  occName,
  occParent,
  occNames,
  removeEdgeFromDraft,
} from './pure';
import { directChildConsolidations } from './collapse';
import { showContextMenu, type ContextMenuItem } from './contextMenu';
import { buildDefaultMemberItems } from './defaultMemberMenu';
import { getL10n, fmt } from '../_shared/l10n';

export {};

const L = getL10n();

export const sortByTypeName = _pureCompareByTypeName;

let _renderDetail: () => void = () => {};
let _handleDrop: (srcName: string, targetName: string) => void = () => {};
let _handleDropMany: (srcNames: string[], targetName: string) => void = () => {};
let _handleMove: (srcs: Array<{ n: string; p: string | null }>, newParent: string | null, anchor?: string, placeAfter?: boolean) => void = () => {};
let _addElement: (parent: string | null) => void = () => {};
// Injected, because `pasteElements` in turn needs `renderTree` — a
// direct import would close a cycle (depcruise build breaker).
let _pasteClipboard: (target: string | null) => void = () => {};

/** Occurrence keys in current visible tree order — Shift-range selects over these. */
export let orderedVisibleOccKeys: string[] = [];

export function setTreeCallbacks(opts: {
  renderDetail: () => void;
  handleDrop: (srcName: string, targetName: string) => void;
  handleDropMany: (srcNames: string[], targetName: string) => void;
  handleMove: (srcs: Array<{ n: string; p: string | null }>, newParent: string | null, anchor?: string, placeAfter?: boolean) => void;
  addElement: (parent: string | null) => void;
  pasteClipboard: (target: string | null) => void;
}): void {
  _renderDetail = opts.renderDetail;
  _handleDrop = opts.handleDrop;
  _handleDropMany = opts.handleDropMany;
  _handleMove = opts.handleMove;
  _addElement = opts.addElement;
  _pasteClipboard = opts.pasteClipboard;
}

export function rebuildFlatView(): void {
  state.flatView = [];
  if (!state.data) return;

  const all = elementsList().filter((el) => el.marked !== 'deleted');

  if (state.searchQuery) {
    const q = state.searchQuery;
    const alias = state.displayAlias;
    const matches = all
      .filter((el) => {
        if (el.name.toLowerCase().includes(q)) { return true; }
        // Also match on the displayed alias value so users can search by alias.
        const av = alias && el.attrs ? el.attrs[alias] : '';
        return av != null && String(av).toLowerCase().includes(q);
      })
      .sort(sortByTypeName);
    for (const el of matches) {
      state.flatView.push({ el, level: 0, hasChildren: false, expanded: true, parent: null });
    }
    return;
  }

  const childrenByParent = new Map<string, EdgeDraft[]>();
  const parentCount = new Map<string, number>();
  for (const e of (state.data.edges || [])) {
    if (e.marked === 'deleted') continue;
    const arr = childrenByParent.get(e.parent) || [];
    arr.push(e);
    childrenByParent.set(e.parent, arr);
    parentCount.set(e.child, (parentCount.get(e.child) || 0) + 1);
  }

  // Top level in TM1 index order — what TM1 shows and what a drag between two
  // top-level rows rewrites. New elements (no index yet) follow, by type/name.
  const roots = all.filter((el) => !parentCount.has(el.name));
  roots.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || sortByTypeName(a, b));

  const pathStack = new Set<string>();
  function pushSubtree(el: ElementDraft, level: number, parent: string | null) {
    if (pathStack.has(el.name)) return;
    pathStack.add(el.name);
    const kidEdges = childrenByParent.get(el.name) || [];
    const hasChildren = kidEdges.length > 0;
    const expanded = !state.collapsed.has(el.name);
    state.flatView.push({ el, level, hasChildren, expanded, parent });
    if (hasChildren && expanded) {
      // Children render in TM1 component order (edge.order), NOT auto-sorted —
      // so manual drag-reordering under a consolidation is honored. Tiebreak by
      // name for legacy edges that carry no order.
      const orderedKidEdges = [...kidEdges].sort((a, b) =>
        ((a.order ?? 0) - (b.order ?? 0)) || String(a.child).localeCompare(String(b.child)));
      const kidEls = orderedKidEdges
        .map(e => findElement(e.child))
        .filter((k): k is ElementDraft => !!k && k.marked !== 'deleted');
      for (const k of kidEls) pushSubtree(k, level + 1, el.name);
    }
    pathStack.delete(el.name);
  }
  for (const r of roots) pushSubtree(r, 0, null);

  const visited = new Set(state.flatView.map(f => f.el.name));
  for (const el of all) {
    if (!visited.has(el.name)) {
      state.flatView.push({ el, level: 0, hasChildren: false, expanded: true, parent: null });
    }
  }

}

export function renderTree(): void {
  rebuildFlatView();
  orderedVisibleOccKeys = state.flatView.map(f => occKey(f.parent, f.el.name));
  const pane = document.querySelector('.tree-pane') as HTMLElement | null;
  const root = document.getElementById('tree-root');
  if (!pane || !root) return;
  if (state.flatView.length === 0) {
    root.style.height = '';
    root.style.position = '';
    root.innerHTML = '<div class="placeholder">' + L.noElements + '</div>';
    return;
  }
  root.style.position = 'relative';
  root.style.height = (state.flatView.length * TREE_ROW_H) + 'px';
  drawVisibleRows(pane, root);
  if (!state.treeScrollBound) {
    state.treeScrollBound = true;
    pane.addEventListener('scroll', () => {
      const r = document.getElementById('tree-root');
      if (r && state.flatView.length > 0) drawVisibleRows(pane, r);
    });
  }
}

function drawVisibleRows(pane: HTMLElement, root: HTMLElement): void {
  const scrollTop = pane.scrollTop;
  const viewH = pane.clientHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / TREE_ROW_H) - TREE_BUFFER);
  const endIdx = Math.min(state.flatView.length, Math.ceil((scrollTop + viewH) / TREE_ROW_H) + TREE_BUFFER);

  root.innerHTML = '';
  for (let i = startIdx; i < endIdx; i++) {
    const row = state.flatView[i];
    const el = row.el;
    const occ = occKey(row.parent, el.name);
    const node = document.createElement('div');
    node.className = 'tree-node';
    if (el.marked && el.marked !== 'clean') node.classList.add(el.marked);
    if (state.selected.has(occ)) node.classList.add('selected');
    node.style.position = 'absolute';
    node.style.top = (i * TREE_ROW_H) + 'px';
    node.style.left = (row.level * 16 + 8) + 'px';
    node.style.right = '8px';
    node.style.height = TREE_ROW_H + 'px';
    node.style.boxSizing = 'border-box';
    node.draggable = true;
    node.dataset.elName = el.name;

    let html = '';
    if (row.hasChildren) {
      html += '<span class="twisty" data-twisty="1">' + (row.expanded ? '▼' : '▶') + '</span>';
    } else {
      html += '<span class="twisty-spacer"></span>';
    }
    const alias = state.displayAlias && el.attrs ? el.attrs[state.displayAlias] : '';
    const label = (alias != null && alias !== '') ? alias : el.name;
    html += typeBadgeHtml(el.type) + escapeHtml(label);
    // Marking of the default member. Two states, because they mean different
    // things: set (stored in the control cube) vs. derived by TM1.
    const dm = state.defaultMembers[state.data?.hierName ?? ''];
    if (dm && dm.effective && dm.effective.toLowerCase() === el.name.toLowerCase()) {
      const explicit = dm.explicit.toLowerCase() === el.name.toLowerCase();
      html += '<span class="dm-mark' + (explicit ? ' dm-explicit' : ' dm-derived') + '" title="'
        + escapeHtml(explicit ? L.defaultMemberSetTitle : L.defaultMemberDerivedTitle)
        + '">★</span>';
    }
    node.innerHTML = html;

    const twisty = node.querySelector('[data-twisty]') as HTMLElement | null;
    if (twisty) {
      twisty.onclick = (ev: Event) => {
        ev.stopPropagation();
        if (state.collapsed.has(el.name)) {
          // Expanding: reset to a one-level view. Collapse the direct child
          // consolidations so re-opening shows only direct children, not the
          // subtree that was expanded before the last collapse.
          state.collapsed.delete(el.name);
          for (const child of directChildConsolidations(state.data?.edges || [], el.name)) {
            state.collapsed.add(child);
          }
        } else {
          state.collapsed.add(el.name);
        }
        renderTree();
      };
    }
    node.onclick = (ev: MouseEvent) => {
      if (ev.shiftKey && state.anchor) {
        // Keep anchor fixed so successive Shift+clicks extend from the same origin.
        state.selected = new Set(computeRange(orderedVisibleOccKeys, state.anchor, occ));
      } else if (ev.ctrlKey || ev.metaKey) {
        toggleSelection(state.selected, occ);
        state.anchor = occ;
      } else {
        state.selected = new Set([occ]);
        state.anchor = occ;
      }
      renderTree();
      _renderDetail();
    };

    node.oncontextmenu = (ev: MouseEvent) => {
      ev.preventDefault();
      // Right-click acts on the clicked occurrence — select it if not already
      // part of the current selection, so the menu always targets what's shown.
      if (!state.selected.has(occ)) {
        state.selected = new Set([occ]);
        state.anchor = occ;
        renderTree();
        _renderDetail();
      }
      openRowMenu(ev.clientX, ev.clientY, row.parent, el.name);
    };

    node.ondragstart = (ev: DragEvent) => {
      // Payload carries occurrences (name + source parent) so a between-rows drop
      // can MOVE the dragged element out of the parent it came from. Gate on the
      // OCCURRENCE count (not distinct names), so two occurrences of the same
      // multi-parent element both travel in a multi-select drag.
      const many = state.selected.has(occ) && state.selected.size >= 2;
      const occs = many
        ? [...state.selected].map(k => ({ n: occName(k), p: occParent(k) }))
        : [{ n: el.name, p: row.parent }];
      ev.dataTransfer!.setData('text/plain', JSON.stringify(occs));
      ev.dataTransfer!.effectAllowed = 'move';
      node.classList.add('drag-source');
    };
    node.ondragend = () => node.classList.remove('drag-source');
    node.ondragover = (ev: DragEvent) => {
      if (!ev.dataTransfer!.types.includes('text/plain')) return;
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = 'move';
      node.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
      // Top/bottom edge = insert as sibling (move under this row's parent);
      // middle = drop onto this row (add as its child, it becomes a C).
      const zone = dropZone(node, ev);
      if (zone === 'before') { node.classList.add('drag-over-before'); }
      else if (zone === 'after') { node.classList.add('drag-over-after'); }
      else { node.classList.add('drag-over'); }
    };
    node.ondragleave = () => node.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
    node.ondrop = (ev: DragEvent) => {
      ev.preventDefault();
      const zone = dropZone(node, ev);
      node.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
      const occs = parseDragOccs(ev.dataTransfer!.getData('text/plain'));
      if (!occs.length) return;
      if (zone === 'on') {
        // Onto target → add as child (existing multi-parent behavior, target → C).
        const names = [...new Set(occs.map(o => o.n))].filter(n => n !== el.name);
        if (names.length === 0) return;
        if (names.length === 1) { _handleDrop(names[0], el.name); }
        else { _handleDropMany(names, el.name); }
      } else {
        // Between rows → move to be a sibling of this row (under row.parent),
        // positioned before/after it per the drop zone (component reorder).
        _handleMove(occs, row.parent, el.name, zone === 'after');
      }
    };

    root.appendChild(node);
  }
}

/**
 * Detach one element occurrence from a single parent node (remove that
 * `parent`->`name` edge only). No-op if the edge is already gone. Re-renders.
 */
export function removeOccurrence(parent: string, name: string): void {
  if (!state.data) return;
  if (removeEdgeFromDraft(state.data, parent, name)) {
    state.data.dirty = true;
    state.selected.delete(occKey(parent, name));
    renderTree();
    _renderDetail();
    updateDirty();
  }
}

/** Which third of the row the pointer is over — top/bottom edge = sibling, middle = onto. */
function dropZone(node: HTMLElement, ev: DragEvent): 'before' | 'after' | 'on' {
  const rect = node.getBoundingClientRect();
  const frac = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0.5;
  if (frac < 0.28) { return 'before'; }
  if (frac > 0.72) { return 'after'; }
  return 'on';
}

/** Parse a drag payload into occurrences; tolerant of a bare name fallback. */
function parseDragOccs(raw: string): Array<{ n: string; p: string | null }> {
  if (!raw) { return []; }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(o => o && typeof o.n === 'string')
        .map(o => ({ n: o.n as string, p: (o.p ?? null) as string | null }));
    }
  } catch { /* not JSON — treat as a bare name below */ }
  return [{ n: raw, p: null }];
}

/** Right-click menu for a tree row: add / add-child / remove-from-node / delete-element. */
function openRowMenu(x: number, y: number, parent: string | null, name: string): void {
  const items: ContextMenuItem[] = [
    { label: L.addElementMenu, onClick: () => _addElement(null) },
    { label: L.addChildElementMenu, onClick: () => _addElement(name) },
  ];
  // Pasting the clipboard — the same path as Ctrl+V, so that structure and
  // type come along here as well. Previously this went through `handleDropMany`, which
  // hung the names flat under the target and lost the structure.
  if (state.clipboard.elements.length) {
    const n = state.clipboard.elements.length;
    items.push({ label: fmt(L, 'pasteAsChild', n), onClick: () => _pasteClipboard(name) });
    if (parent) {
      items.push({ label: fmt(L, 'pasteAsSibling', n), onClick: () => _pasteClipboard(parent) });
    }
  }
  // Default member: a block of its own, set apart by a separator.
  items.push({ separator: true });
  const hier = state.data?.hierName ?? '';
  const onServer = !!state.data?.snapshot?.perHier?.[hier]?.elements?.some(
    (e: { name: string }) => e.name.toLowerCase() === name.toLowerCase(),
  );
  items.push(...buildDefaultMemberItems({
    element: name,
    hier,
    dirty: !!state.data?.dirty,
    onServer,
    state: state.defaultMembers[hier],
    labels: {
      set: L.setDefaultMemberMenu,
      reset: L.resetDefaultMemberMenu,
      blockedDirty: L.defaultMemberBlockedDirty,
      blockedDraft: L.defaultMemberBlockedDraft,
    },
    onSet: (element) => vscode.postMessage({ type: 'setDefaultMember', hier, element }),
  }));
  items.push({ separator: true });
  if (parent) {
    items.push({ label: L.removeFromNode, onClick: () => removeOccurrence(parent, name) });
  }
  items.push({
    label: L.deleteElementTitle,
    danger: true,
    onClick: () => vscode.postMessage({ type: 'checkUsage', elements: occNames(state.selected) }),
  });
  showContextMenu(x, y, items);
}
