import { describe, it, expect, vi } from 'vitest';
import { computeDiff } from '../../dimensionEditor/diff';
import { planCommit } from '../../dimensionEditor/commitPlanner';
import { commitChanges } from '../../dimensionEditor/restEditCommitter';
import { moveInIndex } from '../../webviewClient/dimensionEditor/reindex';
import type { DimDraftState, ElementDraft, EdgeDraft } from '../../dimensionEditor/model';

/**
 * Top-level order = element index. Before 2026-09-30 a drag between two
 * top-level rows showed the drop line and then did nothing: roots were sorted
 * by type/name and the move returned 'noop'. In a dimension of only N elements
 * every row is top level, so no drag ever had an effect.
 */
function el(name: string, index?: number, type: ElementDraft['type'] = 'N'): ElementDraft {
  return { name, type, attrs: {}, marked: 'clean', ...(index === undefined ? {} : { index }) };
}

function state(snapEls: ElementDraft[], draftEls: ElementDraft[], edges: EdgeDraft[] = []): DimDraftState {
  return {
    serverId: 'S', dimName: 'D', hierName: 'D', hierarchies: ['D'],
    elements: new Map(draftEls.map(e => [e.name, e])),
    edges, attrDefs: [], dirty: true,
    snapshot: { dimName: 'D', hierarchies: ['D'], perHier: { D: { elements: snapEls, edges, attrDefs: [] } } },
  };
}

describe('moveInIndex', () => {
  it('moves an element before the anchor and renumbers all', () => {
    const els: Record<string, { name: string; index?: number }> = { B: { name: 'B', index: 0 }, C: { name: 'C', index: 1 }, A: { name: 'A', index: 2 } };
    expect(moveInIndex(els, ['A'], 'B', false)).toBe(true);
    expect(Object.values(els).sort((x, y) => x.index! - y.index!).map(e => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('reports no change when the element already sits there', () => {
    const els = { A: { name: 'A', index: 0 }, B: { name: 'B', index: 1 } };
    expect(moveInIndex(els, ['A'], 'B', false)).toBe(false);
  });
});

describe('reorderElements', () => {
  const snap = [el('B', 0), el('T', 1, 'C'), el('A', 2)];
  const edges: EdgeDraft[] = [{ parent: 'T', child: 'B', weight: 1, marked: 'clean', order: 0 }];

  it('diff emits the full element and edge list when the index order changed', () => {
    const d = computeDiff(state(snap, [el('B', 1), el('T', 2, 'C'), el('A', 0)], edges));
    expect(d.changes).toEqual([{
      kind: 'reorderElements', hier: 'D',
      elements: [{ name: 'A', type: 'N' }, { name: 'B', type: 'N' }, { name: 'T', type: 'C' }],
      edges: [{ parent: 'T', child: 'B', weight: 1 }],
    }]);
  });

  it('a new element at the end alone is no reorder', () => {
    const d = computeDiff(state(snap, [...snap.map(e => ({ ...e })), { ...el('X'), marked: 'new' }], edges));
    expect(d.changes.map(c => c.kind)).toEqual(['addElement']);
  });

  it('runs after the element deletes, through api.reorderElements', async () => {
    const d = computeDiff(state(snap, [el('B', 1), el('T', 2, 'C'), { ...el('A', 0), marked: 'deleted' }, el('Z', 3)], edges));
    // Z is new, A deleted: reorder only if the kept ones moved — they did not.
    expect(d.changes.some(c => c.kind === 'reorderElements')).toBe(false);
    const d2 = computeDiff(state(snap, [el('T', 0, 'C'), el('B', 1), { ...el('A', 2), marked: 'deleted' }], edges));
    const plan = planCommit(d2);
    expect(plan.orderedChanges.map(c => c.kind)).toEqual(['deleteElement', 'reorderElements']);
    const api = { deleteElement: vi.fn().mockResolvedValue(undefined), reorderElements: vi.fn().mockResolvedValue(undefined) } as any;
    const res = await commitChanges(plan, 'D', 'D', api);
    expect(res.ok).toBe(true);
    expect(api.reorderElements).toHaveBeenCalledWith('D', [{ name: 'T', type: 'C' }, { name: 'B', type: 'N' }], [{ parent: 'T', child: 'B', weight: 1 }]);
  });
});
