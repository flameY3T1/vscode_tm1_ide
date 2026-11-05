import { describe, it, expect, vi } from 'vitest';
import { handleMdxMessage, MdxHandlerDeps } from '../mdx/messageHandler';
import type { MdxResult } from '../mdx/executeMdx';

function makeDeps(overrides: Partial<MdxHandlerDeps> = {}): MdxHandlerDeps {
  return {
    execute: vi.fn().mockResolvedValue({ ok: false, error: { code: '0', message: 'not configured' } } as MdxResult),
    continueExecute: vi.fn().mockResolvedValue({ ok: false, error: { code: '0', message: 'nc' } } as MdxResult),
    abortCellset: vi.fn().mockResolvedValue(undefined),
    readClipboard: vi.fn().mockResolvedValue(''),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    getCubes: vi.fn().mockResolvedValue([]),
    getCubeDims: vi.fn().mockResolvedValue([]),
    getDimElements: vi.fn().mockResolvedValue(new Set()),
    getElementNames: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('handleMdxMessage', () => {
  it("forwards 'execute' to executeMdx and returns ok=true result with table", async () => {
    const fakeTable = {
      colHeaders: [['A']],
      colHierarchies: ['Dim'],
      rowHeaders: [],
      rowHierarchies: [],
      titleHeaders: [],
      cells: [[{ value: 1, formatted: '1' }]],
      dims: { cols: 1, rows: 1 },
    };
    const execute = vi.fn().mockResolvedValue({
      ok: true, table: fakeTable, cellsetId: 'x', elapsedMs: 42,
    } as MdxResult);
    const deps = makeDeps({ execute });

    const out = await handleMdxMessage({ type: 'execute', mdx: 'SELECT …' }, deps);

    expect(execute).toHaveBeenCalledWith('SELECT …');
    expect(out).toEqual({
      type: 'result',
      ok: true,
      table: fakeTable,
      elapsedMs: 42,
    });
  });

  it("propagates error from executeMdx as ok=false result", async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false, error: { code: '501', message: 'Syntax error' },
    } as MdxResult);
    const deps = makeDeps({ execute });

    const out = await handleMdxMessage({ type: 'execute', mdx: 'bad' }, deps);

    expect(out).toEqual({
      type: 'result',
      ok: false,
      error: { code: '501', message: 'Syntax error' },
    });
  });

  it("'execute' with empty mdx returns client-side error without calling executeMdx", async () => {
    const execute = vi.fn();
    const deps = makeDeps({ execute });

    const out = await handleMdxMessage({ type: 'execute', mdx: '   ' }, deps);

    expect(execute).not.toHaveBeenCalled();
    expect(out?.type).toBe('result');
    if (out?.type !== 'result') { return; }
    expect(out.ok).toBe(false);
    if (out.ok) { return; }
    expect(out.error.message).toMatch(/empty|leer/i);
  });

  it("'requestPaste' returns pasteText with clipboard content", async () => {
    const readClipboard = vi.fn().mockResolvedValue('clipped');
    const deps = makeDeps({ readClipboard });

    const out = await handleMdxMessage({ type: 'requestPaste' }, deps);

    expect(out).toEqual({ type: 'pasteText', text: 'clipped' });
  });

  it("'requestPaste' surfaces empty string if clipboard read fails", async () => {
    const readClipboard = vi.fn().mockRejectedValue(new Error('denied'));
    const deps = makeDeps({ readClipboard });

    const out = await handleMdxMessage({ type: 'requestPaste' }, deps);

    expect(out).toEqual({ type: 'pasteText', text: '' });
  });

  it("'requestCopy' writes to clipboard and returns no outgoing message", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ writeClipboard });

    const out = await handleMdxMessage({ type: 'requestCopy', text: 'hello' }, deps);

    expect(writeClipboard).toHaveBeenCalledWith('hello');
    expect(out).toBeNull();
  });

  it("'requestCopy' swallows clipboard write errors", async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error('boom'));
    const deps = makeDeps({ writeClipboard });

    const out = await handleMdxMessage({ type: 'requestCopy', text: 'x' }, deps);

    expect(out).toBeNull();
  });

  it('unknown message type returns null', async () => {
    const deps = makeDeps();
    const out = await handleMdxMessage({ type: 'bogus' as any }, deps);
    expect(out).toBeNull();
  });
});

describe('handleMdxMessage — completion + validation + confirmation', () => {
  it("'getCompletions' with context=cubes calls deps.getCubes and returns items", async () => {
    const getCubes = vi.fn().mockResolvedValue(['A', 'B']);
    const deps = makeDeps({ getCubes });

    const out = await handleMdxMessage({ type: 'getCompletions', context: 'cubes', reqId: 7 }, deps);

    expect(getCubes).toHaveBeenCalled();
    expect(out).toEqual({ type: 'completions', context: 'cubes', reqId: 7, items: ['A', 'B'] });
  });

  it("'getCompletions' context=cubeDims passes through cube", async () => {
    const getCubeDims = vi.fn().mockResolvedValue(['Month']);
    const deps = makeDeps({ getCubeDims });

    const out = await handleMdxMessage(
      { type: 'getCompletions', context: 'cubeDims', cube: 'Sales', reqId: 1 }, deps,
    );

    expect(getCubeDims).toHaveBeenCalledWith('Sales');
    expect(out).toEqual({ type: 'completions', context: 'cubeDims', reqId: 1, items: ['Month'] });
  });

  it("'getCompletions' context=dimElements passes dim + hierarchy and keeps the server spelling", async () => {
    const getElementNames = vi.fn().mockResolvedValue(['Jan', 'Feb']);
    const deps = makeDeps({ getElementNames });

    const out = await handleMdxMessage(
      { type: 'getCompletions', context: 'dimElements', dim: 'Month', hier: 'Fiscal', reqId: 2 }, deps,
    );

    expect(getElementNames).toHaveBeenCalledWith('Month', 'Fiscal');
    if (out?.type !== 'completions') { throw new Error('bad type'); }
    expect(out.reqId).toBe(2);
    expect(out.items).toEqual(['Jan', 'Feb']);
  });

  it("'validateNames' groups refs by dim and reports unknown-element", async () => {
    const getDimElements = vi.fn().mockImplementation((dim: string) => {
      if (dim === 'Month') { return Promise.resolve(new Set(['jan', 'feb'])); }
      return Promise.resolve(new Set());
    });
    const getCubes = vi.fn().mockResolvedValue(['Any']);
    const deps = makeDeps({ getCubes, getDimElements });

    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 3,
      cube: null,
      refs: [
        { dim: 'Month', element: 'Jan', offset: 0, length: 13 },
        { dim: 'Month', element: 'Xyz', offset: 20, length: 13 },
      ],
    }, deps);

    expect(out?.type).toBe('validationResult');
    if (out?.type !== 'validationResult') { return; }
    expect(out.version).toBe(3);
    expect(out.invalid).toHaveLength(1);
    expect(out.invalid[0].element).toBe('Xyz');
    expect(out.invalid[0].reason).toBe('unknown-element');
  });

  it("'validateNames' asks the named hierarchy, not the default one", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const deps = makeDeps({
      getCubes: async () => ['C'],
      getDimElements: async (dim: string, hier?: string) => {
        seen.push([dim, hier]);
        return hier === 'Vertrieb' ? new Set(['nord']) : new Set(['sued']);
      },
    });
    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 1,
      cube: null,
      refs: [{ dim: 'Region', hier: 'Vertrieb', element: 'Nord', offset: 0, length: 26 }],
    } as any, deps);
    expect(seen).toEqual([['Region', 'Vertrieb']]);
    expect((out as any).invalid).toEqual([]);
  });

  it("'validateNames' checks only the leaf of a Parent^Child path", async () => {
    const deps = makeDeps({
      getCubes: async () => ['C'],
      getDimElements: async () => new Set(['germany']),
    });
    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 1,
      cube: null,
      refs: [{ dim: 'Region', element: 'Total^Europe^Germany', offset: 0, length: 30 }],
    } as any, deps);
    expect((out as any).invalid).toEqual([]);
  });

  it("'validateNames' stays silent on an unknown hierarchy instead of blaming the dimension", async () => {
    const deps = makeDeps({
      getCubes: async () => ['C'],
      getDimElements: async () => new Set<string>(),
    });
    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 1,
      cube: null,
      refs: [{ dim: 'Region', hier: 'Tippfehler', element: 'Nord', offset: 0, length: 26 }],
    } as any, deps);
    expect((out as any).invalid).toEqual([]);
  });

  it("'validateNames' with cube flags dim-not-in-cube", async () => {
    const getCubes = vi.fn().mockResolvedValue(['Any']);
    const getCubeDims = vi.fn().mockResolvedValue(['Month']);
    const getDimElements = vi.fn().mockResolvedValue(new Set(['jan']));
    const deps = makeDeps({ getCubes, getCubeDims, getDimElements });

    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 1,
      cube: 'Sales',
      refs: [{ dim: 'NotInCube', element: 'X', offset: 0, length: 16 }],
    }, deps);

    if (out?.type !== 'validationResult') { throw new Error('bad type'); }
    expect(out.invalid[0].reason).toBe('dim-not-in-cube');
  });

  it("'validateNames' empty getDimElements → unknown-dimension", async () => {
    const getCubes = vi.fn().mockResolvedValue(['Any']);
    const getDimElements = vi.fn().mockResolvedValue(new Set());
    const deps = makeDeps({ getCubes, getDimElements });

    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 1,
      cube: null,
      refs: [{ dim: 'MissingDim', element: 'X', offset: 0, length: 10 }],
    }, deps);

    if (out?.type !== 'validationResult') { throw new Error('bad type'); }
    expect(out.invalid[0].reason).toBe('unknown-dimension');
  });

  it("'continueLoad' calls deps.continueExecute and returns result", async () => {
    const continueExecute = vi.fn().mockResolvedValue({
      ok: true, table: {} as any, cellsetId: 'cs', elapsedMs: 5,
    } as MdxResult);
    const deps = makeDeps({ continueExecute });

    const out = await handleMdxMessage({ type: 'continueLoad', cellsetId: 'cs' }, deps);

    expect(continueExecute).toHaveBeenCalledWith('cs');
    expect(out?.type).toBe('result');
  });

  it("'abort' calls deps.abortCellset and returns null", async () => {
    const abortCellset = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ abortCellset });

    const out = await handleMdxMessage({ type: 'abort', cellsetId: 'cs' }, deps);

    expect(abortCellset).toHaveBeenCalledWith('cs');
    expect(out).toBeNull();
  });

  it("'validateNames' with empty getCubes (offline) → invalid is empty (no squiggles)", async () => {
    const getCubes = vi.fn().mockResolvedValue([]);
    // These would normally flag, but offline probe should short-circuit.
    const getDimElements = vi.fn().mockResolvedValue(new Set());
    const deps = makeDeps({ getCubes, getDimElements });

    const out = await handleMdxMessage({
      type: 'validateNames',
      version: 1,
      cube: null,
      refs: [{ dim: 'Month', element: 'Xyz', offset: 0, length: 13 }],
    }, deps);

    if (out?.type !== 'validationResult') { throw new Error('bad type'); }
    expect(out.invalid).toEqual([]);
    // getDimElements should NOT have been called due to short-circuit.
    expect(getDimElements).not.toHaveBeenCalled();
  });

  it("'abort' swallows deps.abortCellset rejection", async () => {
    const abortCellset = vi.fn().mockRejectedValue(new Error('net fail'));
    const deps = makeDeps({ abortCellset });
    // Must not throw.
    const out = await handleMdxMessage({ type: 'abort', cellsetId: 'cs' }, deps);
    expect(out).toBeNull();
  });

  it("'execute' returning needsConfirm forwards as cellCountWarning", async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false, needsConfirm: true, cellCount: 90000, cellsetId: 'cs',
    } as MdxResult);
    const deps = makeDeps({ execute });

    const out = await handleMdxMessage({ type: 'execute', mdx: 'SELECT …' }, deps);

    expect(out).toEqual({
      type: 'cellCountWarning',
      cellCount: 90000,
      limit: 50000,
      cellsetId: 'cs',
    });
  });
});

describe('handleMdxMessage — rejected run', () => {
  it('turns a rejected execute into an error result, so the webview leaves "Running"', async () => {
    const deps = makeDeps({ execute: vi.fn().mockRejectedValue(new Error('ECONNRESET')) });
    const out = await handleMdxMessage({ type: 'execute', mdx: 'SELECT …' }, deps);
    expect(out).toEqual({ type: 'result', ok: false, error: { code: 'client', message: 'ECONNRESET' } });
  });
});
