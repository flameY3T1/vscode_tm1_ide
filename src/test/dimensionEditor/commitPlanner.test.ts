// src/test/dimensionEditor/commitPlanner.test.ts
import { describe, it, expect } from 'vitest';
import { planCommit } from '../../dimensionEditor/commitPlanner';
import type { Change, ChangeSet } from '../../dimensionEditor/model';

function cs(changes: Change[]): ChangeSet {
  return { changes, estimatedRestCalls: changes.length };
}

describe('planCommit', () => {
  it('returns ordered changes for a small diff', () => {
    const plan = planCommit(cs([
      { kind: 'addElement', hier: 'P', name: 'A', type: 'N' },
    ]));
    expect(plan.orderedChanges).toHaveLength(1);
  });

  it('returns ordered changes for a large diff', () => {
    const changes: Change[] = Array.from({ length: 25 }, (_, i) => ({
      kind: 'addElement' as const, hier: 'P', name: `E${i}`, type: 'N' as const,
    }));
    const plan = planCommit(cs(changes));
    expect(plan.orderedChanges).toHaveLength(25);
  });

  it('returns ordered operations: hierarchies → attrDefs → addElements → changeType → addEdges → attrs → deleteEdges → deleteElements → deleteAttrDefs → deleteHierarchies', () => {
    const changes: Change[] = [
      { kind: 'deleteElement', hier: 'P', name: 'Z' },
      { kind: 'addHierarchy', name: 'H2' },
      { kind: 'addEdge', hier: 'P', parent: 'All', child: 'B', weight: 1 },
      { kind: 'addElement', hier: 'P', name: 'B', type: 'N' },
      { kind: 'setAttr', hier: 'P', element: 'B', attr: 'alias', value: 'Beta' },
      { kind: 'deleteEdge', hier: 'P', parent: 'All', child: 'Z' },
      { kind: 'addAttrDef', name: 'Region', type: 'String' },
    ];
    const plan = planCommit(cs(changes));
    const kinds = plan.orderedChanges.map(c => c.kind);
    expect(kinds.indexOf('addHierarchy')).toBeLessThan(kinds.indexOf('addAttrDef'));
    expect(kinds.indexOf('addAttrDef')).toBeLessThan(kinds.indexOf('addElement'));
    expect(kinds.indexOf('addElement')).toBeLessThan(kinds.indexOf('addEdge'));
    expect(kinds.indexOf('addEdge')).toBeLessThan(kinds.indexOf('setAttr'));
    expect(kinds.indexOf('setAttr')).toBeLessThan(kinds.indexOf('deleteEdge'));
    expect(kinds.indexOf('deleteEdge')).toBeLessThan(kinds.indexOf('deleteElement'));
  });

  it('sorts addElements topologically: parent consolidations before children', () => {
    // Adding "All" (C) → "Cat1" (C) → "Leaf" (N) requires All before Cat1 before Leaf
    const changes: Change[] = [
      { kind: 'addElement', hier: 'P', name: 'Leaf', type: 'N' },
      { kind: 'addEdge', hier: 'P', parent: 'Cat1', child: 'Leaf', weight: 1 },
      { kind: 'addElement', hier: 'P', name: 'Cat1', type: 'C' },
      { kind: 'addEdge', hier: 'P', parent: 'All', child: 'Cat1', weight: 1 },
      { kind: 'addElement', hier: 'P', name: 'All', type: 'C' },
    ];
    const plan = planCommit(cs(changes));
    const addEls = plan.orderedChanges
      .filter(c => c.kind === 'addElement')
      .map(c => (c as any).name);
    expect(addEls.indexOf('All')).toBeLessThan(addEls.indexOf('Cat1'));
    expect(addEls.indexOf('Cat1')).toBeLessThan(addEls.indexOf('Leaf'));
  });

  it('ranks reorderComponents after addEdge', () => {
    const changes: Change[] = [
      { kind: 'reorderComponents', hier: 'P', parent: 'All', children: [{ name: 'B', weight: 1 }] },
      { kind: 'addEdge', hier: 'P', parent: 'All', child: 'B', weight: 1 },
    ];
    const kinds = planCommit(cs(changes)).orderedChanges.map(c => c.kind);
    expect(kinds.indexOf('addEdge')).toBeLessThan(kinds.indexOf('reorderComponents'));
  });

  it('CommitPlan has no backend field', () => {
    const plan = planCommit({ changes: [], estimatedRestCalls: 0 });
    expect('backend' in plan).toBe(false);
    expect(plan.orderedChanges).toEqual([]);
  });

  it('empty change set → empty plan', () => {
    const plan = planCommit(cs([]));
    expect(plan.orderedChanges).toEqual([]);
  });
});
