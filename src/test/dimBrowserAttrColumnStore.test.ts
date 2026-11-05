import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadAttrColumns, saveAttrColumns, purgeAttrColumnsForServer, ATTRCOL_STATE_KEY,
} from '../commands/dimension/attrColumnStore';

function makeCtx() {
  const store = new Map<string, unknown>();
  return { globalState: {
    get: <T,>(k: string) => store.get(k) as T | undefined,
    update: vi.fn((k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); }),
  } } as never as Parameters<typeof loadAttrColumns>[0];
}
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('attrColumnStore', () => {
  it('an unknown dimension returns an empty selection, no throw', () => {
    expect(loadAttrColumns(ctx, 's1', 'Stations')).toEqual({ cols: [], widths: {} });
  });

  it('round trip per server AND dimension', async () => {
    await saveAttrColumns(ctx, 's1', 'A', ['X'], { X: 200 });
    await saveAttrColumns(ctx, 's2', 'A', ['Y'], {});
    expect(loadAttrColumns(ctx, 's1', 'A')).toEqual({ cols: ['X'], widths: { X: 200 } });
    expect(loadAttrColumns(ctx, 's2', 'A')).toEqual({ cols: ['Y'], widths: {} });
  });

  it('an empty selection DELETES the entry, instead of collecting garbage', async () => {
    await saveAttrColumns(ctx, 's1', 'A', ['X'], {});
    await saveAttrColumns(ctx, 's1', 'A', [], {});
    expect(ctx.globalState.get(ATTRCOL_STATE_KEY)).toEqual({});
  });

  it('broken globalState is ignored, not thrown', () => {
    void ctx.globalState.update(ATTRCOL_STATE_KEY, 'kaputt');
    expect(loadAttrColumns(ctx, 's1', 'A')).toEqual({ cols: [], widths: {} });
  });

  it('cleaning up removes exactly the entries of THIS server', async () => {
    await saveAttrColumns(ctx, 'weg', 'A', ['X'], {});
    await saveAttrColumns(ctx, 'weg', 'B', ['Y'], {});
    await saveAttrColumns(ctx, 'bleibt', 'A', ['Z'], {});
    expect(await purgeAttrColumnsForServer(ctx, 'weg')).toBe(2);
    expect(loadAttrColumns(ctx, 'bleibt', 'A').cols).toEqual(['Z']);
  });

  it('without a hit nothing is written at all', async () => {
    await saveAttrColumns(ctx, 'bleibt', 'A', ['Z'], {});
    vi.mocked(ctx.globalState.update).mockClear();
    expect(await purgeAttrColumnsForServer(ctx, 'nie')).toBe(0);
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });

  it('a colon in the dimension name mixes up no entries', async () => {
    // The key is `serverId::dimName`. Without separation,
    // `s::a` + `b` could not be told apart from `s` + `a::b`.
    await saveAttrColumns(ctx, 's::a', 'b', ['X'], {});
    expect(loadAttrColumns(ctx, 's', 'a::b').cols).toEqual([]);
  });
});
