import { describe, it, expect } from 'vitest';
import {
  children, descendants, expandAllSet, leaves, parents, allParents,
} from '../webviewClient/_shared/hierarchy/operations';
import type { HierarchyStructure } from '../webviewClient/_shared/hierarchy/types';

// P(level2) -> A(level1) -> { x(leaf,N), y(leaf,N) ; B(level1,C) -> z(leaf,N) }
const S: HierarchyStructure = {
  childrenOf: { P: ['A', 'B'], A: ['x', 'y'], B: ['z'] },
  parentOf: { A: 'P', B: 'P', x: 'A', y: 'A', z: 'B' },
  allParentsOf: { A: ['P'], B: ['P'], x: ['A'], y: ['A'], z: ['B'] },
  meta: {
    P: { name: 'P', type: 'C', level: 2 },
    A: { name: 'A', type: 'C', level: 1 },
    B: { name: 'B', type: 'C', level: 1 },
    x: { name: 'x', type: 'N', level: 0 },
    y: { name: 'y', type: 'N', level: 0 },
    z: { name: 'z', type: 'N', level: 0 },
  },
};

describe('hierarchy operations', () => {
  it('children returns direct children only', () => {
    expect(children(S, 'P')).toEqual(['A', 'B']);
    expect(children(S, 'A')).toEqual(['x', 'y']);
    expect(children(S, 'x')).toEqual([]);
  });
  it('descendants returns all, DFS, excluding the root', () => {
    expect(descendants(S, 'P')).toEqual(['A', 'x', 'y', 'B', 'z']);
  });
  it('expandAllSet includes the root', () => {
    expect(expandAllSet(S, 'A')).toEqual(['A', 'x', 'y']);
  });
  it('leaves returns level-0 descendants (N-only fixture)', () => {
    expect(leaves(S, 'P').sort()).toEqual(['x', 'y', 'z']);
  });
  it('leaves = level-0 descendants (incl. childless consolidations, excl. typed mids)', () => {
    const S = {
      childrenOf: { P: ['A', 'B'], A: ['x', 'y'] },
      parentOf: { A: 'P', B: 'P', x: 'A', y: 'A' },
      allParentsOf: {},
      meta: {
        P: { name: 'P', type: 'C', level: 2 },
        A: { name: 'A', type: 'C', level: 1 },
        B: { name: 'B', type: 'C', level: 0 }, // empty consolidation → level 0 → leaf
        x: { name: 'x', type: 'N', level: 0 },
        y: { name: 'y', type: 'N', level: 0 },
      },
    };
    expect(leaves(S as any, 'P').sort()).toEqual(['B', 'x', 'y']);
  });
  it('parents / allParents walk upward', () => {
    expect(parents(S, 'x')).toEqual(['A']);
    expect(allParents(S, 'x').sort()).toEqual(['A', 'P']);
  });
  it('descendants is cycle-safe', () => {
    const cyc: HierarchyStructure = {
      childrenOf: { a: ['b'], b: ['a'] }, parentOf: {}, allParentsOf: {}, meta: {},
    };
    expect(descendants(cyc, 'a')).toEqual(['b']);
  });
});
