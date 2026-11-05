import { describe, it, expect, vi } from 'vitest';
import { commitChanges } from '../../dimensionEditor/restEditCommitter';
import type { CommitPlan } from '../../dimensionEditor/commitPlanner';

function api() {
  return {
    createElements: vi.fn().mockResolvedValue(undefined),
    changeElementType: vi.fn().mockResolvedValue(undefined),
    addEdges: vi.fn().mockResolvedValue(undefined),
    deleteEdge: vi.fn().mockResolvedValue(undefined),
    deleteElement: vi.fn().mockResolvedValue(undefined),
    createAttrDef: vi.fn().mockResolvedValue(undefined),
    deleteAttrDef: vi.fn().mockResolvedValue(undefined),
    createHierarchy: vi.fn().mockResolvedValue(undefined),
    deleteHierarchy: vi.fn().mockResolvedValue(undefined),
    writeAttrValues: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('commitChanges', () => {
  it('batches addElement into one createElements call', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addElement', hier: 'D', name: 'A', type: 'N' },
      { kind: 'addElement', hier: 'D', name: 'B', type: 'N' },
    ] };
    await commitChanges(plan, 'D', 'D', a);
    expect(a.createElements).toHaveBeenCalledTimes(1);
    expect(a.createElements).toHaveBeenCalledWith('D', [{ name: 'A', type: 'N' }, { name: 'B', type: 'N' }]);
  });

  // Alternate hierarchies: the draft can carry changes in SEVERAL hierarchies
  // (the editor loads them on demand and keeps them in the draft until it is
  // saved). The batches must then not take the hierarchy of the first entry for
  // all of them — otherwise a save creates the elements of the secondary hierarchy in
  // the main hierarchy, and they are missing from the secondary hierarchy.
  it('batches addElement PER HIERARCHY, not all into the first', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addElement', hier: 'D', name: 'A', type: 'N' },
      { kind: 'addElement', hier: 'ab', name: 'X', type: 'N' },
      { kind: 'addElement', hier: 'D', name: 'B', type: 'N' },
    ] };
    await commitChanges(plan, 'D', 'D', a);
    expect(a.createElements).toHaveBeenCalledTimes(2);
    expect(a.createElements).toHaveBeenCalledWith('D', [{ name: 'A', type: 'N' }, { name: 'B', type: 'N' }]);
    expect(a.createElements).toHaveBeenCalledWith('ab', [{ name: 'X', type: 'N' }]);
  });

  it('batches addEdge PER HIERARCHY, not all into the first', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addEdge', hier: 'D', parent: 'T', child: 'A', weight: 1 },
      { kind: 'addEdge', hier: 'ab', parent: 'T2', child: 'X', weight: 1 },
    ] };
    await commitChanges(plan, 'D', 'D', a);
    expect(a.addEdges).toHaveBeenCalledTimes(2);
    expect(a.addEdges).toHaveBeenCalledWith('D', [{ parent: 'T', child: 'A', weight: 1 }]);
    expect(a.addEdges).toHaveBeenCalledWith('ab', [{ parent: 'T2', child: 'X', weight: 1 }]);
  });

  it('keeps every element add before every edge add across hierarchies', async () => {
    // An edge in `ab` must not run before the element exists in `ab`.
    const a = api();
    const order: string[] = [];
    a.createElements.mockImplementation((h: string) => { order.push(`el:${h}`); return Promise.resolve(); });
    a.addEdges.mockImplementation((h: string) => { order.push(`ed:${h}`); return Promise.resolve(); });
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addElement', hier: 'D', name: 'A', type: 'N' },
      { kind: 'addEdge', hier: 'D', parent: 'T', child: 'A', weight: 1 },
      { kind: 'addElement', hier: 'ab', name: 'X', type: 'N' },
      { kind: 'addEdge', hier: 'ab', parent: 'T2', child: 'X', weight: 1 },
    ] };
    await commitChanges(plan, 'D', 'D', a);
    expect(order).toEqual(['el:D', 'el:ab', 'ed:D', 'ed:ab']);
  });

  it('reorderComponents = deleteEdge per child + addEdges in order', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'reorderComponents', hier: 'D', parent: 'T', children: [
        { name: 'C', weight: 1 }, { name: 'A', weight: 1 }] },
    ] };
    await commitChanges(plan, 'D', 'D', a);
    expect(a.deleteEdge).toHaveBeenCalledWith('D', 'T', 'C');
    expect(a.deleteEdge).toHaveBeenCalledWith('D', 'T', 'A');
    expect(a.addEdges).toHaveBeenCalledWith('D', [
      { parent: 'T', child: 'C', weight: 1 }, { parent: 'T', child: 'A', weight: 1 }]);
  });

  it('batches setAttr/clearAttr into one writeAttrValues (clear = empty string)', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'setAttr', hier: 'Alt', element: 'A', attr: 'alias', value: 'aa' },
      { kind: 'clearAttr', hier: 'Alt', element: 'B', attr: 'alias' },
    ] };
    await commitChanges(plan, 'D', 'Alt', a);
    expect(a.writeAttrValues).toHaveBeenCalledWith([
      { hier: 'Alt', element: 'A', attr: 'alias', value: 'aa' },
      { hier: 'Alt', element: 'B', attr: 'alias', value: '' }]);
  });

  it('collects errors, sets serverMayHaveChanged after a successful write', async () => {
    const a = api();
    a.deleteElement.mockRejectedValue(new Error('nope'));
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addElement', hier: 'D', name: 'A', type: 'N' },
      { kind: 'deleteElement', hier: 'D', name: 'X' },
    ] };
    const r = await commitChanges(plan, 'D', 'D', a);
    expect(r.ok).toBe(false);
    expect(r.serverMayHaveChanged).toBe(true);
    expect(r.errors[0].message).toContain('nope');
  });

  it('changeType calls changeElementType with newType', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [{ kind: 'changeType', hier: 'D', name: 'X', newType: 'C' }] };
    await commitChanges(plan, 'D', 'D', a);
    expect(a.changeElementType).toHaveBeenCalledWith('D', 'X', 'C');
  });

  it('deleteEdge (standalone) calls api.deleteEdge', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [{ kind: 'deleteEdge', hier: 'D', parent: 'T', child: 'A' }] };
    await commitChanges(plan, 'D', 'D', a);
    expect(a.deleteEdge).toHaveBeenCalledWith('D', 'T', 'A');
  });

  it('addEdge + reorderComponents on same parent: no duplicate/spurious edge ops', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addEdge', hier: 'D', parent: 'T', child: 'New', weight: 1 },
      { kind: 'reorderComponents', hier: 'D', parent: 'T', children: [
        { name: 'New', weight: 1 }, { name: 'A', weight: 1 }, { name: 'B', weight: 1 }] },
    ] };
    const r = await commitChanges(plan, 'D', 'D', a);
    expect(r.ok).toBe(true);
    // addEdges called for the standalone new edge BEFORE reorder's delete/re-add
    const addEdgesCalls = a.addEdges.mock.calls.map((c: any[]) => c[1]);
    expect(addEdgesCalls[0]).toEqual([{ parent: 'T', child: 'New', weight: 1 }]);
    // reorder re-adds full ordered child list
    expect(addEdgesCalls[1]).toEqual([
      { parent: 'T', child: 'New', weight: 1 },
      { parent: 'T', child: 'A', weight: 1 },
      { parent: 'T', child: 'B', weight: 1 }]);
    // reorder's delete must run AFTER the standalone addEdges batch (edge must exist first)
    expect(a.deleteEdge).toHaveBeenCalledWith('D', 'T', 'New');
  });
});
