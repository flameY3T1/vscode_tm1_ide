import { describe, it, expect } from 'vitest';
import { loadView, saveView } from '../../commands/consolidationCompare/viewStore';
import type { KeyedMemento } from '../../utils/keyedStore';

function fakeCtx(): KeyedMemento {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(k: string) => store.get(k) as T | undefined,
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
  };
}

describe('consolidation compare view store', () => {
  it('keeps unticked "Only differences" and ticked grouping without any picks', async () => {
    const ctx = fakeCtx();
    const v = { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: true, onlyDiff: false };
    await saveView(ctx, 's', 'D', 'D', v);
    expect(loadView(ctx, 's', 'D', 'D')).toEqual(v);
  });
});
