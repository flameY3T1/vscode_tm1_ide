// src/dimensionEditor/diff.ts
import type {
  Change, ChangeSet, DimDraftState, EdgeDraft, ElementDraft, HierarchySnapshot,
} from './model';
import { attrWireValue, buildEdges } from './hierarchyPayload';

/** Live elements in draft index order; new ones (no index) keep insertion order at the end. */
function byIndex(els: Iterable<ElementDraft>): ElementDraft[] {
  return [...els].filter(e => e.marked !== 'deleted')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.index ?? Infinity) - (b.e.index ?? Infinity) || a.i - b.i)
    .map(x => x.e);
}

export function computeDiff(state: DimDraftState): ChangeSet {
  const changes: Change[] = [];
  const snap = state.snapshot;
  const hier = state.hierName;
  const snapHier: HierarchySnapshot | undefined = snap.perHier[hier];

  // Hierarchy-level diffs (add/delete)
  const snapHierSet = new Set(snap.hierarchies);
  const stateHierSet = new Set(state.hierarchies);
  for (const h of state.hierarchies) {
    if (!snapHierSet.has(h)) changes.push({ kind: 'addHierarchy', name: h });
  }
  for (const h of snap.hierarchies) {
    if (!stateHierSet.has(h)) changes.push({ kind: 'deleteHierarchy', name: h });
  }

  if (snapHier) {
    // Element diffs
    const snapElByName = new Map(snapHier.elements.map(e => [e.name, e]));
    for (const el of state.elements.values()) {
      const prev = snapElByName.get(el.name);
      if (el.marked === 'deleted') {
        if (prev) changes.push({ kind: 'deleteElement', hier, name: el.name });
        continue;
      }
      if (!prev) {
        changes.push({ kind: 'addElement', hier, name: el.name, type: el.type });
      } else if (prev.type !== el.type) {
        changes.push({ kind: 'changeType', hier, name: el.name, newType: el.type });
      }
      // Attribute diffs (skip for deleted elements — continue already handled above)
      const prevAttrs = prev?.attrs ?? {};
      for (const [attrName, value] of Object.entries(el.attrs)) {
        const prevVal = prevAttrs[attrName] ?? '';
        if (value === prevVal) continue;
        if (value === '') {
          changes.push({ kind: 'clearAttr', hier, element: el.name, attr: attrName });
        } else {
          changes.push({ kind: 'setAttr', hier, element: el.name, attr: attrName, value: attrWireValue(state, attrName, value) });
        }
      }
    }

    // Component-order diffs FIRST (before the edge loop) so a weight-change
    // delete+add can be suppressed for any parent that is ALSO being reordered.
    // For each parent whose live child sequence differs from the "natural" order
    // (snapshot order, with new children appended in commit/creation order),
    // emit one reorderComponents carrying the full desired child sequence. This
    // only fires on a genuine reorder / insert-at-position.
    const reorderChanges: Change[] = [];
    const reorderedParents = new Set<string>();
    {
      const draftByParent = new Map<string, EdgeDraft[]>();
      for (const e of state.edges) {
        if (e.marked === 'deleted') continue;
        const arr = draftByParent.get(e.parent) ?? [];
        arr.push(e);
        draftByParent.set(e.parent, arr);
      }
      const snapByParent = new Map<string, EdgeDraft[]>();
      for (const e of snapHier.edges) {
        const arr = snapByParent.get(e.parent) ?? [];
        arr.push(e);
        snapByParent.set(e.parent, arr);
      }
      const byOrder = (a: EdgeDraft, b: EdgeDraft) => (a.order ?? 0) - (b.order ?? 0);
      for (const [parent, dEdges] of draftByParent) {
        if (dEdges.length < 2) continue; // single child → nothing to order
        const draftOrdered = [...dEdges].sort(byOrder);
        const draftNames = draftOrdered.map(e => e.child);
        // "existing" = snapshot-order children still live in the draft.
        const snapOrdered = [...(snapByParent.get(parent) ?? [])].sort(byOrder);
        const draftSet = new Set(draftNames);
        const existing = snapOrdered.map(e => e.child).filter(n => draftSet.has(n));
        const existingSet = new Set(existing);
        // "appended" = brand-new children in their actual COMMIT order = the
        // `state.edges` array (creation) order. addEdge changes are emitted in
        // this order, so the natural post-commit sequence is
        // existing-then-creation-order — NOT draft .order order (which would make
        // the comparison tautological and miss a reorder of pure-new siblings).
        const appended = state.edges
          .filter(e => e.parent === parent && e.marked !== 'deleted' && !existingSet.has(e.child))
          .map(e => e.child);
        const natural = [...existing, ...appended];
        const differs = natural.some((n, i) => n !== draftNames[i]);
        if (!differs) continue;
        reorderedParents.add(parent);
        reorderChanges.push({
          kind: 'reorderComponents',
          hier,
          parent,
          children: draftOrdered.map(e => ({ name: e.child, weight: e.weight })),
        });
      }
    }

    // Edge diffs (compare by parent+child tuple)
    const edgeKey = (e: { parent: string; child: string }) => `${e.parent}→${e.child}`;
    const snapEdges = new Map(snapHier.edges.map(e => [edgeKey(e), e]));
    const stateKeys = new Set<string>();
    for (const e of state.edges) {
      const k = edgeKey(e);
      stateKeys.add(k);
      if (e.marked === 'deleted') {
        if (snapEdges.has(k)) changes.push({ kind: 'deleteEdge', hier, parent: e.parent, child: e.child });
        continue;
      }
      const prev = snapEdges.get(k);
      if (!prev || prev.weight !== e.weight) {
        if (prev) {
          // Weight change: PATCH the edge in place. If this parent is ALSO
          // being reordered, the reorderComponents (delete-all-components +
          // re-add at the DRAFT weight) already sets the new weight.
          if (!reorderedParents.has(e.parent)) {
            changes.push({ kind: 'setEdgeWeight', hier, parent: e.parent, child: e.child, weight: e.weight });
          }
          continue;
        }
        // Genuinely new edge (!prev): always push its addEdge, even under a
        // reordered parent — the edge must exist before the reorder's
        // component-delete runs.
        changes.push({ kind: 'addEdge', hier, parent: e.parent, child: e.child, weight: e.weight });
      }
    }
    for (const [k, prev] of snapEdges) {
      if (!stateKeys.has(k)) {
        changes.push({ kind: 'deleteEdge', hier, parent: prev.parent, child: prev.child });
      }
    }

    changes.push(...reorderChanges);

    // Element index order: compare the elements that exist on both sides. New
    // elements alone do not count — the server appends them anyway.
    const draftOrder = byIndex(state.elements.values());
    const kept = new Set(snapHier.elements.map(e => e.name));
    const draftKept = draftOrder.filter(e => kept.has(e.name)).map(e => e.name);
    const live = new Set(draftKept);
    const snapKept = snapHier.elements.map(e => e.name).filter(n => live.has(n));
    if (draftKept.some((n, i) => n !== snapKept[i])) {
      changes.push({
        kind: 'reorderElements',
        hier,
        elements: draftOrder.map(e => ({ name: e.name, type: e.type })),
        edges: buildEdges(state),
      });
    }

    // Attribute-Definition diffs
    const snapDefs = new Map(snapHier.attrDefs.map(d => [d.name, d]));
    for (const d of state.attrDefs) {
      if (d.marked === 'deleted') {
        if (snapDefs.has(d.name)) changes.push({ kind: 'deleteAttrDef', name: d.name });
      } else if (!snapDefs.has(d.name)) {
        changes.push({ kind: 'addAttrDef', name: d.name, type: d.type });
      }
    }
  }

  return { changes, estimatedRestCalls: changes.length };
}
