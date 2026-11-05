// src/dimensionEditor/commitPlanner.ts
import type { Change, ChangeSet } from './model';

export interface CommitPlan {
  orderedChanges: Change[];
}

const ORDER: Record<Change['kind'], number> = {
  addHierarchy:    10,
  addAttrDef:      30,
  addElement:      40,
  changeType:      50,
  addEdge:         60,
  setEdgeWeight:   62,
  reorderComponents: 65, // after components exist (addEdge), before deletes
  setAttr:         70,
  clearAttr:       75,
  deleteEdge:      80,
  deleteElement:   90,
  reorderElements: 95, // last element step: the PATCH carries the final element set
  deleteAttrDef:  100,
  deleteHierarchy: 110,
};

export function planCommit(changeSet: ChangeSet): CommitPlan {

  // Stable sort by ORDER, then topologically within addElement by edge-dependency.
  const sorted = changeSet.changes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ORDER[a.c.kind] - ORDER[b.c.kind] || a.i - b.i)
    .map(x => x.c);

  // Topo-sort addElements: if an element appears as `parent` of an addEdge where child is also added, parent comes first.
  const addEls = sorted.filter(c => c.kind === 'addElement') as Extract<Change, { kind: 'addElement' }>[];
  const addEdges = sorted.filter(c => c.kind === 'addEdge') as Extract<Change, { kind: 'addEdge' }>[];
  const addNames = new Set(addEls.map(c => c.name));
  const parentOf = new Map<string, Set<string>>();
  for (const e of addEdges) {
    if (!addNames.has(e.child)) continue;
    const set = parentOf.get(e.child) ?? new Set();
    if (addNames.has(e.parent)) set.add(e.parent);
    parentOf.set(e.child, set);
  }
  const visited = new Set<string>();
  const topo: string[] = [];
  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    for (const p of parentOf.get(name) ?? []) visit(p);
    topo.push(name);
  }
  for (const el of addEls) visit(el.name);
  const addElByName = new Map(addEls.map(c => [c.name, c]));
  const orderedAddEls = topo.map(n => addElByName.get(n)!).filter(Boolean);

  // Rebuild list with topo-sorted addElements in place.
  const result: Change[] = [];
  let addElIdx = 0;
  for (const c of sorted) {
    if (c.kind === 'addElement') {
      if (addElIdx < orderedAddEls.length) {
        result.push(orderedAddEls[addElIdx++]);
      }
    } else {
      result.push(c);
    }
  }

  return { orderedChanges: result };
}
