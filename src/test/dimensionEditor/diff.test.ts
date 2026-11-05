// src/test/dimensionEditor/diff.test.ts
import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../dimensionEditor/diff';
import type {
  DimDraftState, DimSnapshot, ElementDraft, EdgeDraft, AttrDef,
} from '../../dimensionEditor/model';

function makeSnapshot(opts: {
  dimName?: string;
  hier?: string;
  elements?: ElementDraft[];
  edges?: EdgeDraft[];
  attrDefs?: AttrDef[];
}): DimSnapshot {
  const hier = opts.hier ?? 'Products';
  return {
    dimName: opts.dimName ?? 'Products',
    hierarchies: [hier],
    perHier: {
      [hier]: {
        elements: opts.elements ?? [],
        edges: opts.edges ?? [],
        attrDefs: opts.attrDefs ?? [],
      },
    },
  };
}

function makeState(snap: DimSnapshot, overrides?: Partial<DimDraftState>): DimDraftState {
  const hier = snap.hierarchies[0];
  const h = snap.perHier[hier];
  return {
    serverId: 'S1',
    dimName: snap.dimName,
    hierName: hier,
    hierarchies: [...snap.hierarchies],
    elements: new Map(h.elements.map(e => [e.name, { ...e, attrs: { ...e.attrs } }])),
    edges: h.edges.map(e => ({ ...e })),
    attrDefs: h.attrDefs.map(a => ({ ...a })),
    snapshot: snap,
    dirty: false,
    ...overrides,
  };
}

describe('computeDiff', () => {
  it('empty diff when state equals snapshot', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
    ]});
    const state = makeState(snap);
    expect(computeDiff(state).changes).toEqual([]);
  });

  it('detects added element', () => {
    const snap = makeSnapshot({ elements: [] });
    const state = makeState(snap);
    state.elements.set('B', { name: 'B', type: 'N', attrs: {}, marked: 'new' });
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'addElement', hier: 'Products', name: 'B', type: 'N',
    });
  });

  it('detects deleted element', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.get('A')!.marked = 'deleted';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'deleteElement', hier: 'Products', name: 'A',
    });
  });

  it('detects type change', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.get('A')!.type = 'C';
    state.elements.get('A')!.marked = 'changed';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'changeType', hier: 'Products', name: 'A', newType: 'C',
    });
  });

  it('detects attr set', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: { alias: 'Alpha' }, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.get('A')!.attrs.alias = 'Beta';
    state.elements.get('A')!.marked = 'changed';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'setAttr', hier: 'Products', element: 'A', attr: 'alias', value: 'Beta',
    });
  });

  // A string is parsed in the server locale: "15.5" landed as 155 on a German server.
  it('sends a Numeric attribute value as a JSON number, text attributes as strings', () => {
    const snap = makeSnapshot({
      elements: [{ name: 'A', type: 'N', attrs: { price: '1', label: 'x' }, marked: 'clean' }],
      attrDefs: [
        { name: 'price', type: 'Numeric', marked: 'clean' },
        { name: 'label', type: 'String', marked: 'clean' },
      ],
    });
    const state = makeState(snap);
    state.elements.get('A')!.attrs.price = '15.5';
    state.elements.get('A')!.attrs.label = '15.5';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'setAttr', hier: 'Products', element: 'A', attr: 'price', value: 15.5 });
    expect(diff.changes).toContainEqual({ kind: 'setAttr', hier: 'Products', element: 'A', attr: 'label', value: '15.5' });
  });

  it('detects attr clear (from value to empty)', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: { alias: 'Alpha' }, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.get('A')!.attrs.alias = '';
    state.elements.get('A')!.marked = 'changed';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'clearAttr', hier: 'Products', element: 'A', attr: 'alias',
    });
  });

  it('detects added edge', () => {
    const snap = makeSnapshot({ edges: [] });
    const state = makeState(snap);
    state.edges.push({ parent: 'All', child: 'A', weight: 1, marked: 'new' });
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'addEdge', hier: 'Products', parent: 'All', child: 'A', weight: 1,
    });
  });

  it('detects deleted edge', () => {
    const snap = makeSnapshot({ edges: [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.edges[0].marked = 'deleted';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'deleteEdge', hier: 'Products', parent: 'All', child: 'A',
    });
  });

  it('emits setComponentOrder when children are reordered under a parent', () => {
    const elements: ElementDraft[] = [
      { name: 'All', type: 'C', attrs: {}, marked: 'clean' },
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
      { name: 'B', type: 'N', attrs: {}, marked: 'clean' },
      { name: 'C', type: 'N', attrs: {}, marked: 'clean' },
    ];
    const edges: EdgeDraft[] = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 1 },
      { parent: 'All', child: 'C', weight: 1, marked: 'clean', order: 2 },
    ];
    const snap = makeSnapshot({ elements, edges });
    const state = makeState(snap);
    // Reorder to C, A, B.
    state.edges = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 1 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 2 },
      { parent: 'All', child: 'C', weight: 1, marked: 'clean', order: 0 },
    ];
    const reorder = computeDiff(state).changes.filter(c => c.kind === 'reorderComponents');
    expect(reorder).toEqual([{
      kind: 'reorderComponents', hier: 'Products', parent: 'All',
      children: [{ name: 'C', weight: 1 }, { name: 'A', weight: 1 }, { name: 'B', weight: 1 }],
    }]);
  });

  it('does NOT emit setComponentOrder when order is unchanged', () => {
    const elements: ElementDraft[] = [
      { name: 'All', type: 'C', attrs: {}, marked: 'clean' },
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
      { name: 'B', type: 'N', attrs: {}, marked: 'clean' },
    ];
    const edges: EdgeDraft[] = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 1 },
    ];
    const snap = makeSnapshot({ elements, edges });
    const state = makeState(snap);
    expect(computeDiff(state).changes.filter(c => c.kind === 'reorderComponents')).toEqual([]);
  });

  it('does NOT emit setComponentOrder when a new child is appended at the end', () => {
    const elements: ElementDraft[] = [
      { name: 'All', type: 'C', attrs: {}, marked: 'clean' },
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
    ];
    const edges: EdgeDraft[] = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
    ];
    const snap = makeSnapshot({ elements, edges });
    const state = makeState(snap);
    state.elements.set('B', { name: 'B', type: 'N', attrs: {}, marked: 'new' });
    state.edges = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
      { parent: 'All', child: 'B', weight: 1, marked: 'new', order: 1 },
    ];
    expect(computeDiff(state).changes.filter(c => c.kind === 'reorderComponents')).toEqual([]);
  });

  it('emits reorderComponents when NEW siblings are reordered vs their creation order', () => {
    // Snapshot: All → A, B. Add two NEW children X, Y. X is created before Y in
    // state.edges (its commit/creation order), but .order makes the draft order
    // A, B, Y, X. The natural post-commit order is A, B, X, Y (creation order),
    // so the reorder MUST be detected and carry the full .order sequence.
    const elements: ElementDraft[] = [
      { name: 'All', type: 'C', attrs: {}, marked: 'clean' },
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
      { name: 'B', type: 'N', attrs: {}, marked: 'clean' },
    ];
    const edges: EdgeDraft[] = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 1 },
    ];
    const snap = makeSnapshot({ elements, edges });
    const state = makeState(snap);
    state.elements.set('X', { name: 'X', type: 'N', attrs: {}, marked: 'new' });
    state.elements.set('Y', { name: 'Y', type: 'N', attrs: {}, marked: 'new' });
    // state.edges array order = creation order: A, B, X, Y (X before Y). But
    // .order = A0, B1, Y2, X3 → draft order A, B, Y, X.
    state.edges = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 1 },
      { parent: 'All', child: 'X', weight: 1, marked: 'new', order: 3 },
      { parent: 'All', child: 'Y', weight: 1, marked: 'new', order: 2 },
    ];
    const reorder = computeDiff(state).changes.filter(c => c.kind === 'reorderComponents');
    expect(reorder).toEqual([{
      kind: 'reorderComponents', hier: 'Products', parent: 'All',
      children: [
        { name: 'A', weight: 1 }, { name: 'B', weight: 1 },
        { name: 'Y', weight: 1 }, { name: 'X', weight: 1 },
      ],
    }]);
  });

  it('suppresses weight-change delete+add for a parent that is ALSO reordered', () => {
    // Snapshot: All → A (w1), B (w1). Draft reorders to B, A AND changes A's
    // weight to 2. The reorderComponents (delete-all + re-add at draft weight)
    // already re-establishes All→A at w2; a leftover deleteEdge(All,A) would run
    // after the reorder and drop the child — so it must be suppressed.
    const elements: ElementDraft[] = [
      { name: 'All', type: 'C', attrs: {}, marked: 'clean' },
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
      { name: 'B', type: 'N', attrs: {}, marked: 'clean' },
    ];
    const edges: EdgeDraft[] = [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean', order: 0 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 1 },
    ];
    const snap = makeSnapshot({ elements, edges });
    const state = makeState(snap);
    state.edges = [
      { parent: 'All', child: 'A', weight: 2, marked: 'clean', order: 1 },
      { parent: 'All', child: 'B', weight: 1, marked: 'clean', order: 0 },
    ];
    const changes = computeDiff(state).changes;
    const edgeChangesForA = changes.filter(c =>
      (c.kind === 'deleteEdge' || c.kind === 'addEdge') && c.parent === 'All' && c.child === 'A');
    expect(edgeChangesForA).toEqual([]);
    const reorderForAll = changes.filter(c => c.kind === 'reorderComponents' && c.parent === 'All');
    expect(reorderForAll.length).toBe(1);
  });

  it('detects added attribute definition', () => {
    const snap = makeSnapshot({ attrDefs: [] });
    const state = makeState(snap);
    state.attrDefs.push({ name: 'Region', type: 'String', marked: 'new' });
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'addAttrDef', name: 'Region', type: 'String',
    });
  });

  it('detects deleted attribute definition', () => {
    const snap = makeSnapshot({ attrDefs: [
      { name: 'Region', type: 'String', marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.attrDefs[0].marked = 'deleted';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({
      kind: 'deleteAttrDef', name: 'Region',
    });
  });

  it('detects added hierarchy', () => {
    const snap = makeSnapshot({});
    const state = makeState(snap);
    state.hierarchies.push('Geography');
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'addHierarchy', name: 'Geography' });
  });

  it('detects deleted hierarchy', () => {
    const snap: DimSnapshot = {
      dimName: 'Products',
      hierarchies: ['Products', 'Geography'],
      perHier: {
        Products: { elements: [], edges: [], attrDefs: [] },
        Geography: { elements: [], edges: [], attrDefs: [] },
      },
    };
    const state = makeState(snap);
    state.hierarchies = ['Products'];
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'deleteHierarchy', name: 'Geography' });
  });

  it('aggregates multiple changes', () => {
    const snap = makeSnapshot({
      elements: [{ name: 'A', type: 'N', attrs: {}, marked: 'clean' }],
      edges: [],
    });
    const state = makeState(snap);
    state.elements.set('B', { name: 'B', type: 'N', attrs: {}, marked: 'new' });
    state.elements.get('A')!.type = 'C';
    state.elements.get('A')!.marked = 'changed';
    state.edges.push({ parent: 'A', child: 'B', weight: 1, marked: 'new' });
    const diff = computeDiff(state);
    expect(diff.changes.length).toBe(3);
    expect(diff.estimatedRestCalls).toBeGreaterThanOrEqual(3);
  });

  it('omits unchanged elements from diff', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: { alias: 'Alpha' }, marked: 'clean' },
      { name: 'B', type: 'N', attrs: {}, marked: 'clean' },
    ]});
    const state = makeState(snap);
    expect(computeDiff(state).changes).toEqual([]);
  });
});

describe('computeDiff — additional edge cases', () => {
  it('detects edge weight change as one setEdgeWeight (no delete+add)', () => {
    const snap = makeSnapshot({ edges: [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.edges[0].weight = 2;
    const diff = computeDiff(state);
    expect(diff.changes).toEqual([{ kind: 'setEdgeWeight', hier: 'Products', parent: 'All', child: 'A', weight: 2 }]);
  });

  it('detects edge removed from state (not present but in snapshot)', () => {
    const snap = makeSnapshot({ edges: [
      { parent: 'All', child: 'A', weight: 1, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.edges = [];  // removed entirely
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'deleteEdge', hier: 'Products', parent: 'All', child: 'A' });
  });

  it('idempotent: same state twice gives same diff', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.set('B', { name: 'B', type: 'N', attrs: {}, marked: 'new' });
    const d1 = computeDiff(state);
    const d2 = computeDiff(state);
    expect(d1.changes).toEqual(d2.changes);
  });

  it('idempotent on empty state', () => {
    const snap = makeSnapshot({});
    const state = makeState(snap);
    expect(computeDiff(state).changes).toEqual([]);
    expect(computeDiff(state).changes).toEqual([]);
  });

  it('setAttr with new attribute not in snapshot', () => {
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: {}, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.get('A')!.attrs.region = 'Global';
    state.elements.get('A')!.marked = 'changed';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'setAttr', hier: 'Products', element: 'A', attr: 'region', value: 'Global' });
  });

  it('deleted element drops its attr-set-changes from diff', () => {
    // When an element is being deleted, we don't need to emit setAttr for it
    const snap = makeSnapshot({ elements: [
      { name: 'A', type: 'N', attrs: { alias: 'Alpha' }, marked: 'clean' },
    ]});
    const state = makeState(snap);
    state.elements.get('A')!.marked = 'deleted';
    state.elements.get('A')!.attrs.alias = 'DifferentButIrrelevant';
    const diff = computeDiff(state);
    const setAttrs = diff.changes.filter(c => c.kind === 'setAttr');
    expect(setAttrs).toEqual([]);
    expect(diff.changes).toContainEqual({ kind: 'deleteElement', hier: 'Products', name: 'A' });
  });

  it('multi-hier: only active hierarchy compared', () => {
    const snap: DimSnapshot = {
      dimName: 'Products',
      hierarchies: ['Products', 'Alt'],
      perHier: {
        Products: { elements: [{ name: 'A', type: 'N', attrs: {}, marked: 'clean' }], edges: [], attrDefs: [] },
        Alt:      { elements: [{ name: 'X', type: 'N', attrs: {}, marked: 'clean' }], edges: [], attrDefs: [] },
      },
    };
    // state is viewing Products, no changes to Alt
    const state = makeState(snap);
    expect(computeDiff(state).changes).toEqual([]);
  });

  it('estimatedRestCalls matches change count', () => {
    const snap = makeSnapshot({ elements: [] });
    const state = makeState(snap);
    state.elements.set('B', { name: 'B', type: 'N', attrs: {}, marked: 'new' });
    state.elements.set('C', { name: 'C', type: 'N', attrs: {}, marked: 'new' });
    state.elements.set('D', { name: 'D', type: 'N', attrs: {}, marked: 'new' });
    expect(computeDiff(state).estimatedRestCalls).toBe(3);
  });

  it('addAttrDef with Alias type', () => {
    const snap = makeSnapshot({ attrDefs: [] });
    const state = makeState(snap);
    state.attrDefs.push({ name: 'EnglishName', type: 'Alias', marked: 'new' });
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'addAttrDef', name: 'EnglishName', type: 'Alias' });
  });

  it('deleting an attribute def AND its values in the same diff', () => {
    const snap = makeSnapshot({
      elements: [{ name: 'A', type: 'N', attrs: { region: 'X' }, marked: 'clean' }],
      attrDefs: [{ name: 'region', type: 'String', marked: 'clean' }],
    });
    const state = makeState(snap);
    // Mark the attr def as deleted
    state.attrDefs[0].marked = 'deleted';
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'deleteAttrDef', name: 'region' });
  });

  it('addElement with S type', () => {
    const snap = makeSnapshot({ elements: [] });
    const state = makeState(snap);
    state.elements.set('Str', { name: 'Str', type: 'S', attrs: {}, marked: 'new' });
    const diff = computeDiff(state);
    expect(diff.changes).toContainEqual({ kind: 'addElement', hier: 'Products', name: 'Str', type: 'S' });
  });
});
