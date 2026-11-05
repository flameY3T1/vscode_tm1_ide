import { it, expect } from 'vitest';
import { computeDiff } from '../../dimensionEditor/diff';
import { planCommit } from '../../dimensionEditor/commitPlanner';
import { commitChanges } from '../../dimensionEditor/restEditCommitter';
import type { DimSnapshot, DimDraftState, ElementDraft, EdgeDraft } from '../../dimensionEditor/model';

// Runs diff → plan → committer end to end. The weight change used to become
// deleteEdge + addEdge, and the committer's batched addEdges ran BEFORE the
// ordered deleteEdge: the edge was re-added and then deleted, so the child
// dropped out of its consolidation (or the POST on an existing edge aborted
// the whole commit).
it('a weight change PATCHes the edge in place, nothing is deleted or re-added', async () => {
  const el = (name: string, type: 'N' | 'C') => ({ name, type, attrs: {}, marked: 'clean' }) as unknown as ElementDraft;
  const edge = (weight: number) => ({ parent: 'P', child: 'C', weight, marked: 'clean' }) as unknown as EdgeDraft;
  const snap: DimSnapshot = { dimName: 'D', hierarchies: ['D'], perHier: { D: {
    elements: [el('P', 'C'), el('C', 'N')], edges: [edge(1)], attrDefs: [],
  } } };
  const state: DimDraftState = {
    serverId: 'S', dimName: 'D', hierName: 'D', hierarchies: ['D'],
    elements: new Map(snap.perHier.D.elements.map(e => [e.name, { ...e }])),
    edges: [edge(-1)], attrDefs: [], snapshot: snap, dirty: true,
  };
  const calls: string[] = [];
  const api = new Proxy({}, {
    get: (_t, p) => async (...a: unknown[]) => { calls.push(`${String(p)} ${JSON.stringify(a)}`); },
  }) as never;

  const result = await commitChanges(planCommit(computeDiff(state)), 'D', 'D', api);

  expect(result.ok).toBe(true);
  expect(calls).toEqual(['setEdgeWeight ["D","P","C",-1]']);
});
