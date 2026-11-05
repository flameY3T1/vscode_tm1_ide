/**
 * Regression guards for the data-loss fixes B1–B6 (Codex review status
 * 2026-08-10). Each test pins the *behaviour that used to be wrong*, not the
 * implementation that fixes it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitChanges } from '../dimensionEditor/restEditCommitter';
import type { CommitPlan } from '../dimensionEditor/commitPlanner';
import { buildReferenceIndex } from '../references/referenceIndex';
import {
  createDraftStore, type DraftMemento,
} from '../utils/draftStore';
import {
  dimensionDraftKey, draftFitsStore, MAX_DRAFT_BYTES, type DimensionDraft,
} from '../commands/dimension/dimensionDraftStore';

// ── B3: dimension commit stops at the first failure ──────────────────────────

function api(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  } as any;
}

describe('B3 — dimension commit aborts after a partial failure', () => {
  it('does not run later changes once one step failed', async () => {
    const a = api({ createAttrDef: vi.fn().mockRejectedValue(new Error('boom')) });
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addAttrDef', hier: 'D', name: 'alias', type: 'Alias' },
      { kind: 'deleteElement', hier: 'D', name: 'X' },
      { kind: 'deleteElement', hier: 'D', name: 'Y' },
    ] as CommitPlan['orderedChanges'] };

    const res = await commitChanges(plan, 'D', 'D', a);

    expect(a.deleteElement).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    // The user learns that the rest was left alone — silence would read as
    // "everything else went through".
    expect(res.errors.some(e => /not applied/i.test(e.message))).toBe(true);
  });

  it('still re-adds the children of a reorder whose delete failed', async () => {
    // reorderComponents removes ALL of a parent's children before re-adding them.
    // Aborting between the two halves would leave the parent stripped, so the
    // re-add is a recovery step and runs even after the abort.
    let call = 0;
    const a = api({
      deleteEdge: vi.fn().mockImplementation(() => {
        call++;
        return call === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(undefined);
      }),
    });
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'reorderComponents', hier: 'D', parent: 'T', children: [
        { name: 'A', weight: 1 }, { name: 'B', weight: 1 }] },
    ] as CommitPlan['orderedChanges'] };

    const res = await commitChanges(plan, 'D', 'D', a);

    expect(a.addEdges).toHaveBeenCalledWith('D', [
      { parent: 'T', child: 'A', weight: 1 }, { parent: 'T', child: 'B', weight: 1 }]);
    expect(res.ok).toBe(false);
  });

  it('leaves a clean run untouched', async () => {
    const a = api();
    const plan: CommitPlan = { orderedChanges: [
      { kind: 'addElement', hier: 'D', name: 'A', type: 'N' },
      { kind: 'deleteElement', hier: 'D', name: 'X' },
    ] as CommitPlan['orderedChanges'] };

    const res = await commitChanges(plan, 'D', 'D', a);

    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(a.deleteElement).toHaveBeenCalledTimes(1);
  });
});

// ── B6: the reference index admits when it is partial ────────────────────────

describe('B6 — reference index reports failed sources', () => {
  const okDeps = {
    fetchProcesses: async () => [{ processName: 'P', code: "CellGetN('C','x');" }],
    fetchCubesWithRules: async () => [],
  };

  it('marks a failed source instead of presenting an empty result as fact', async () => {
    const idx = await buildReferenceIndex({
      ...okDeps,
      fetchCubesWithRules: async () => { throw new Error('500'); },
    } as any);

    expect(idx.incomplete).toEqual(['cube rules']);
  });

  it('is empty for a fully successful build', async () => {
    const idx = await buildReferenceIndex(okDeps as any);
    expect(idx.incomplete).toEqual([]);
  });

  it('reports every failed source, not just the first', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => { throw new Error('x'); },
      fetchCubesWithRules: async () => { throw new Error('x'); },
      fetchChores: async () => { throw new Error('x'); },
    } as any);

    expect(idx.incomplete.sort()).toEqual(['chores', 'cube rules', 'processes']);
  });
});

// ── B4: dimension drafts survive a panel close ───────────────────────────────

function memento(): DraftMemento & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: <T,>(key: string, dflt: T) => (key in data ? data[key] as T : dflt),
    update: async (key: string, value: unknown) => { data[key] = value; },
  };
}

function draft(extra: Partial<DimensionDraft> = {}): DimensionDraft {
  return {
    serverId: 'http://s', dimName: 'D', hierName: 'D', hierarchies: ['D'],
    elements: { A: { name: 'A', type: 'N' } }, edges: [], attrDefs: [],
    snapshot: {}, dirty: true, ...extra,
  };
}

describe('B4 — dimension editor draft parking', () => {
  const store = createDraftStore<DimensionDraft>('tm1.dimensionDrafts',
    (d) => !!(d as DimensionDraft)?.elements && !!(d as DimensionDraft)?.dimName);

  let m: ReturnType<typeof memento>;
  beforeEach(() => { m = memento(); });

  it('parks and returns a draft under its dim + hierarchy key', async () => {
    const key = dimensionDraftKey('http://s', 'D', 'H');
    await store.save(m, key, draft({ hierName: 'H' }), 1000);

    const back = store.load(m, key);
    expect(back?.dimName).toBe('D');
    expect(back?.savedAt).toBe(1000);
    // A different hierarchy of the same dimension is a different draft.
    expect(store.load(m, dimensionDraftKey('http://s', 'D', 'Other'))).toBeUndefined();
  });

  it('drops a draft once it was saved or discarded', async () => {
    const key = dimensionDraftKey('http://s', 'D', 'D');
    await store.save(m, key, draft(), 1);
    await store.clear(m, key);
    expect(store.load(m, key)).toBeUndefined();
  });

  it('refuses a payload larger than the store cap', () => {
    expect(draftFitsStore(draft())).toBe(true);
    const huge = draft({ elements: { big: 'x'.repeat(MAX_DRAFT_BYTES + 1) } });
    expect(draftFitsStore(huge)).toBe(false);
  });
});
