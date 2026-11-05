import { describe, it, expect } from 'vitest';
import { planReparent, deleteElementFromDraft, settlePersistedNew, nextOrder, reindexChildren } from '../../../webviewClient/dimensionEditor/pure';

describe('planReparent', () => {
  it('adds a new edge when none exists', () => {
    expect(planReparent([], 'A', 'P')).toEqual({ action: 'add' });
  });
  it('skips when src === target', () => {
    expect(planReparent([], 'A', 'A')).toEqual({ action: 'skip', reason: 'self' });
  });
  it('skips an existing live edge', () => {
    const edges = [{ parent: 'P', child: 'A', marked: 'clean' }];
    expect(planReparent(edges, 'A', 'P')).toEqual({ action: 'skip', reason: 'exists' });
  });
  it('restores a deleted edge instead of adding', () => {
    const edges = [{ parent: 'P', child: 'A', marked: 'deleted' }];
    expect(planReparent(edges, 'A', 'P')).toEqual({ action: 'restore' });
  });
  it('skips when target is a descendant of src (cycle)', () => {
    const edges = [
      { parent: 'A', child: 'B', marked: 'clean' },
      { parent: 'B', child: 'P', marked: 'clean' },
    ];
    expect(planReparent(edges, 'A', 'P')).toEqual({ action: 'skip', reason: 'cycle' });
  });
});

describe('deleteElementFromDraft', () => {
  function draft() {
    return {
      elements: {
        A: { name: 'A', marked: 'clean' },
        B: { name: 'B', marked: 'new' },
        P: { name: 'P', marked: 'clean' },
      } as Record<string, { name: string; marked?: string }>,
      edges: [
        { parent: 'P', child: 'A', marked: 'clean' },
        { parent: 'P', child: 'B', marked: 'new' },
      ] as Array<{ parent: string; child: string; marked?: string }>,
    };
  }

  it('marks a clean element deleted and marks its clean edges deleted', () => {
    const d = draft();
    deleteElementFromDraft(d, 'A');
    expect(d.elements.A.marked).toBe('deleted');
    expect(d.edges.find(e => e.child === 'A')!.marked).toBe('deleted');
  });

  it('removes a new element and drops its new edges entirely', () => {
    const d = draft();
    deleteElementFromDraft(d, 'B');
    expect(d.elements.B).toBeUndefined();
    expect(d.edges.some(e => e.child === 'B')).toBe(false);
  });

  it('is a no-op for an unknown element', () => {
    const d = draft();
    const before = JSON.stringify(d);
    deleteElementFromDraft(d, 'ZZZ');
    expect(JSON.stringify(d)).toBe(before);
  });

  it('handles deleting a new parent and its new child in sequence', () => {
    const d = {
      elements: {
        P: { name: 'P', marked: 'new' },
        A: { name: 'A', marked: 'new' },
      } as Record<string, { name: string; marked?: string }>,
      edges: [{ parent: 'P', child: 'A', marked: 'new' }] as Array<{ parent: string; child: string; marked?: string }>,
    };
    deleteElementFromDraft(d, 'P');
    deleteElementFromDraft(d, 'A');
    expect(d.elements.P).toBeUndefined();
    expect(d.elements.A).toBeUndefined();
    expect(d.edges).toHaveLength(0);
  });
});

describe('settlePersistedNew', () => {
  it('a new element the partial commit created is deleted for real afterwards', () => {
    const data = {
      elements: { Added: { name: 'Added', marked: 'new' }, Pending: { name: 'Pending', marked: 'new' } },
      edges: [],
      attrDefs: [{ name: 'Made', marked: 'new' }, { name: 'Open', marked: 'new' }],
    };
    settlePersistedNew(data, { elements: [{ name: 'Added' }], attrDefs: [{ name: 'Made' }] });
    expect(data.elements.Pending.marked).toBe('new');
    expect(data.attrDefs.map(d => d.marked)).toEqual(['changed', 'new']);
    // Still in the draft and marked deleted, so the diff emits deleteElement.
    deleteElementFromDraft(data, 'Added');
    expect(data.elements.Added?.marked).toBe('deleted');
  });
  it('no snapshot for the hierarchy leaves the draft alone', () => {
    const data = { elements: { A: { name: 'A', marked: 'new' } } };
    settlePersistedNew(data, undefined);
    expect(data.elements.A.marked).toBe('new');
  });
});

describe('nextOrder', () => {
  it('returns max live sibling order + 1', () => {
    const edges = [
      { parent: 'P', child: 'A', marked: 'clean', order: 0 },
      { parent: 'P', child: 'B', marked: 'clean', order: 1 },
      { parent: 'Q', child: 'C', marked: 'clean', order: 5 },
    ];
    expect(nextOrder(edges, 'P')).toBe(2);
    expect(nextOrder(edges, 'Q')).toBe(6);
  });

  it('ignores deleted edges and starts at 0 for an unknown parent', () => {
    const edges = [{ parent: 'P', child: 'A', marked: 'deleted', order: 3 }];
    expect(nextOrder(edges, 'P')).toBe(0);
    expect(nextOrder(edges, 'ZZZ')).toBe(0);
  });
});

describe('reindexChildren', () => {
  function draft() {
    return {
      elements: {} as Record<string, { name: string; marked?: string }>,
      edges: [
        { parent: 'P', child: 'A', marked: 'clean', order: 0 },
        { parent: 'P', child: 'B', marked: 'clean', order: 1 },
        { parent: 'P', child: 'C', marked: 'clean', order: 2 },
      ] as Array<{ parent: string; child: string; marked?: string; order?: number }>,
    };
  }

  it('assigns 0-based order matching the given sequence', () => {
    const d = draft();
    reindexChildren(d, 'P', ['C', 'A', 'B']);
    const ord = Object.fromEntries(d.edges.map(e => [e.child, e.order]));
    expect(ord).toEqual({ C: 0, A: 1, B: 2 });
  });

  it('appends live children missing from the sequence after the listed ones', () => {
    const d = draft();
    reindexChildren(d, 'P', ['B']);
    expect(d.edges.find(e => e.child === 'B')!.order).toBe(0);
    // A and C keep a stable trailing order after B.
    const a = d.edges.find(e => e.child === 'A')!.order!;
    const c = d.edges.find(e => e.child === 'C')!.order!;
    expect(new Set([a, c])).toEqual(new Set([1, 2]));
  });

  it('ignores deleted edges', () => {
    const d = {
      elements: {} as Record<string, { name: string; marked?: string }>,
      edges: [
        { parent: 'P', child: 'A', marked: 'deleted', order: 0 },
        { parent: 'P', child: 'B', marked: 'clean', order: 1 },
      ] as Array<{ parent: string; child: string; marked?: string; order?: number }>,
    };
    reindexChildren(d, 'P', ['B']);
    expect(d.edges.find(e => e.child === 'B')!.order).toBe(0);
    expect(d.edges.find(e => e.child === 'A')!.order).toBe(0); // untouched (deleted)
  });
});
