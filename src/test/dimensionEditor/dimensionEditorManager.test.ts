import { describe, it, expect, vi } from 'vitest';
import { computeDiff } from '../../dimensionEditor/diff';
import { planCommit } from '../../dimensionEditor/commitPlanner';
import { commitChanges } from '../../dimensionEditor/restEditCommitter';
import type { DimDraftState, DimSnapshot } from '../../dimensionEditor/model';

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    createElements: vi.fn(async () => {}),
    deleteElement: vi.fn(async () => {}),
    addEdges: vi.fn(async () => {}),
    deleteEdge: vi.fn(async () => {}),
    writeAttrValues: vi.fn(async () => {}),
    createHierarchy: vi.fn(async () => {}),
    deleteHierarchy: vi.fn(async () => {}),
    createAttrDef: vi.fn(async () => {}),
    deleteAttrDef: vi.fn(async () => {}),
    changeElementType: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('Commit pipeline integration', () => {
  it('small diff → commitChanges → all ops executed via REST', async () => {
    const snap: DimSnapshot = {
      dimName: 'D',
      hierarchies: ['D'],
      perHier: { D: { elements: [], edges: [], attrDefs: [] } },
    };
    const state: DimDraftState = {
      serverId: 'S', dimName: 'D', hierName: 'D',
      hierarchies: ['D'],
      elements: new Map([['A', { name: 'A', type: 'N', attrs: {}, marked: 'new' }]]),
      edges: [],
      attrDefs: [],
      snapshot: snap,
      dirty: true,
    };
    const api = makeApi();
    const diff = computeDiff(state);
    const plan = planCommit(diff);
    const r = await commitChanges(plan, 'D', 'D', api as any);
    expect(r.ok).toBe(true);
    expect(api.createElements).toHaveBeenCalledWith('D', [{ name: 'A', type: 'N' }]);
  });

  it('large diff (30 new elements) → still one batched createElements call', async () => {
    const snap: DimSnapshot = {
      dimName: 'D', hierarchies: ['D'],
      perHier: { D: { elements: [], edges: [], attrDefs: [] } },
    };
    const state: DimDraftState = {
      serverId: 'S', dimName: 'D', hierName: 'D', hierarchies: ['D'],
      elements: new Map(Array.from({ length: 30 }, (_, i) => [
        `E${i}`, { name: `E${i}`, type: 'N' as const, attrs: {}, marked: 'new' as const },
      ])),
      edges: [], attrDefs: [], snapshot: snap, dirty: true,
    };
    const diff = computeDiff(state);
    expect(diff.changes.length).toBe(30);
    const plan = planCommit(diff);
    const api = makeApi();
    const r = await commitChanges(plan, 'D', 'D', api as any);
    expect(r.ok).toBe(true);
    expect(api.createElements).toHaveBeenCalledTimes(1);
    expect((api.createElements as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(30);
  });

  it('commitChanges collects the batch error when createElements throws', async () => {
    const api = makeApi({
      createElements: vi.fn(async () => { throw new Error('boom-batch'); }),
    });
    const snap: DimSnapshot = {
      dimName: 'D', hierarchies: ['D'],
      perHier: { D: { elements: [], edges: [], attrDefs: [] } },
    };
    const state: DimDraftState = {
      serverId: 'S', dimName: 'D', hierName: 'D', hierarchies: ['D'],
      elements: new Map([
        ['A', { name: 'A', type: 'N', attrs: {}, marked: 'new' }],
        ['B', { name: 'B', type: 'N', attrs: {}, marked: 'new' }],
        ['C', { name: 'C', type: 'N', attrs: {}, marked: 'new' }],
      ]),
      edges: [], attrDefs: [], snapshot: snap, dirty: true,
    };
    const diff = computeDiff(state);
    const plan = planCommit(diff);
    const r = await commitChanges(plan, 'D', 'D', api as any);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].message).toContain('boom-batch');
    expect(r.errors[0].message).toContain('addElements');
    expect(api.createElements).toHaveBeenCalledTimes(1);
  });
});
