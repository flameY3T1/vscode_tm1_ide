import { describe, it, expect } from 'vitest';
import { loadReorderInit } from '../../commands/cube/reorderDimsInit';

describe('loadReorderInit', () => {
  it('assembles current, counts and recommended order', async () => {
    const api = {
      getStorageDimensionOrder: async () => ['A', 'B', 'C'],
      getDimensionLeafCount: async (_cfg: unknown, dim: string) =>
        ({ A: 30, B: 10, C: 20 }[dim] ?? null),
    };
    const init = await loadReorderInit(undefined as never, 'Sales', api);
    expect(init.current).toEqual(['A', 'B', 'C']);
    expect(init.counts).toEqual({ A: 30, B: 10, C: 20 });
    expect(init.recommended).toEqual(['B', 'A', 'C']); // C pinned last, B(10)<A(30)
  });
});
