import { describe, it, expect, vi } from 'vitest';
import { applyDraft, type EdgeWriter } from '../../consolidationCompare/applyDraft';
import type { Edge } from '../../consolidationCompare/comparePure';

const E = (rows: Array<[string, string, number]>): Edge[] => rows.map(([parent, child, weight]) => ({ parent, child, weight }));
const BASE = E([['T', 'A', 1], ['T', 'B', 1], ['U', 'A', 1]]);

function writer(failOn?: keyof EdgeWriter) {
  const calls: string[] = [];
  const api: EdgeWriter = {
    deleteEdge: vi.fn(async (_h, p, c) => { calls.push(`del ${p}>${c}`); if (failOn === 'deleteEdge') { throw new Error('boom'); } }),
    setEdgeWeight: vi.fn(async (_h, p, c, w) => { calls.push(`w ${p}>${c}=${w}`); if (failOn === 'setEdgeWeight') { throw new Error('boom'); } }),
    addEdges: vi.fn(async (_h, es) => { calls.push(`add ${es.map((e: Edge) => `${e.parent}>${e.child}`).join(',')}`); }),
  };
  return { api, calls };
}

const CHANGES = [
  { action: 'add' as const, parent: 'U', child: 'B', weight: 1 },
  { action: 'weight' as const, parent: 'T', child: 'B', weight: -1 },
  { action: 'remove' as const, parent: 'T', child: 'A' },
];

describe('applyDraft', () => {
  it('writes remove, then weight, then one add, and returns the re-read state', async () => {
    const { api, calls } = writer();
    const after = E([['T', 'B', -1], ['U', 'A', 1], ['U', 'B', 1]]);
    const read = vi.fn().mockResolvedValueOnce(BASE).mockResolvedValueOnce(after);
    const r = await applyDraft(api, read, 'H', BASE, CHANGES);
    expect(calls).toEqual(['del T>A', 'w T>B=-1', 'add U>B']);
    expect(r).toEqual({ ok: true, edges: after });
  });

  it('refuses before the first write when the server changed', async () => {
    const { api, calls } = writer();
    const changed = E([['T', 'A', 1], ['T', 'B', 2], ['U', 'A', 1]]);
    const r = await applyDraft(api, vi.fn().mockResolvedValue(changed), 'H', BASE, CHANGES);
    expect(calls).toEqual([]);
    expect(r).toEqual({ ok: false, conflict: true, edges: changed });
  });

  it('stops at the failing write and returns the real state', async () => {
    const { api, calls } = writer('setEdgeWeight');
    const partial = E([['T', 'B', 1], ['U', 'A', 1]]);
    const read = vi.fn().mockResolvedValueOnce(BASE).mockResolvedValueOnce(partial);
    const r = await applyDraft(api, read, 'H', BASE, CHANGES);
    expect(calls).toEqual(['del T>A', 'w T>B=-1']);
    expect(r).toEqual({ ok: false, conflict: false, message: 'boom', edges: partial });
  });
});
