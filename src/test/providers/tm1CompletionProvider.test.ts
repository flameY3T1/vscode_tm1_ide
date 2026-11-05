import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../providers/fetchNames', () => ({
  fetchNames: vi.fn(),
  invalidateCache: vi.fn(),
  warmCache: vi.fn(),
}));

import {
  TiFunctionCompletionProvider,
  TiVariableCompletionProvider,
  TiContextCompletionProvider,
  Tm1CompletionProvider,
  getTiVariableParse,
} from '../../providers/tm1CompletionProvider';
import { fetchNames } from '../../providers/fetchNames';

interface MockDoc {
  getText: (range?: unknown) => string;
  uri: { fsPath: string };
  getWordRangeAtPosition: (position: unknown, regex: RegExp) => unknown;
  lineAt: (idx: number) => { text: string };
}

function makeDoc(text: string, opts?: { wordAt?: string }): MockDoc {
  const lines = text.split('\n');
  return {
    getText: (range?: unknown) => {
      if (range && opts?.wordAt) { return opts.wordAt; }
      return text;
    },
    uri: { fsPath: '' },
    getWordRangeAtPosition: (_pos: unknown, _re: RegExp) => {
      return opts?.wordAt !== undefined ? { _word: opts.wordAt } : undefined;
    },
    lineAt: (idx: number) => ({ text: lines[idx] ?? '' }),
  };
}

describe('TiFunctionCompletionProvider', () => {
  const provider = new TiFunctionCompletionProvider();

  it('constructor populates items from KNOWN_SIGNATURES', () => {
    const items = provider.provideCompletionItems(makeDoc('') as never, { line: 0, character: 0 } as never);
    expect(items.length).toBeGreaterThan(50);
  });

  it('returns full list when no word at cursor', () => {
    const doc = makeDoc('') as never;
    const items = provider.provideCompletionItems(doc, { line: 0, character: 0 } as never);
    expect(items.length).toBeGreaterThan(0);
  });

  it('returns empty array when typed word shorter than 2 chars', () => {
    const doc = makeDoc('c', { wordAt: 'c' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 0, character: 1 } as never);
    expect(items).toEqual([]);
  });

  it('filters items by case-insensitive substring (infix match)', () => {
    const doc = makeDoc('cellget', { wordAt: 'cellget' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 0, character: 7 } as never);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect((item.label as string).toLowerCase().includes('cellget')).toBe(true);
    }
  });

  it('does NOT set filterText on function items (preserves VS Code CamelCase match)', () => {
    const items = provider.provideCompletionItems(makeDoc('') as never, { line: 0, character: 0 } as never);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.filterText).toBeUndefined();
    }
  });

  it('case-insensitive match works for uppercase input', () => {
    const lower = new TiFunctionCompletionProvider().provideCompletionItems(
      makeDoc('cellget', { wordAt: 'cellget' }) as never,
      { line: 0, character: 7 } as never,
    );
    const upper = provider.provideCompletionItems(
      makeDoc('CELLGET', { wordAt: 'CELLGET' }) as never,
      { line: 0, character: 7 } as never,
    );
    expect(upper.length).toBe(lower.length);
  });
});

describe('TiVariableCompletionProvider', () => {
  const provider = new TiVariableCompletionProvider();

  it('returns empty when no word at cursor', () => {
    const items = provider.provideCompletionItems(
      makeDoc('') as never,
      { line: 0, character: 0 } as never,
    );
    expect(items).toEqual([]);
  });

  it('returns empty when typed word shorter than 2 chars', () => {
    const doc = makeDoc('x', { wordAt: 'x' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 0, character: 1 } as never);
    expect(items).toEqual([]);
  });

  it('returns Parameters from .pro 560/561 header', () => {
    const text = [
      '602,"P"',
      '560,1',
      'pCube',
      '561,1',
      '2',
      '572,1',
      'SomeCode;',
      '573,0',
      '574,0',
      '575,0',
    ].join('\n');
    const doc = makeDoc(text, { wordAt: 'pc' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 6, character: 2 } as never);
    expect(items.find(i => i.label === 'pCube')).toBeDefined();
  });

  it('returns Datasource variables from .pro 577 header', () => {
    const text = [
      '602,"P"',
      '577,1',
      'vDsVar',
      '572,1',
      'SomeCode;',
      '573,0',
      '574,0',
      '575,0',
    ].join('\n');
    const doc = makeDoc(text, { wordAt: 'vd' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 4, character: 2 } as never);
    expect(items.find(i => i.label === 'vDsVar')).toBeDefined();
  });

  it('returns code identifiers (camelCase match: "pd" -> "pDim")', () => {
    const text = [
      '572,1',
      'pDim := 1;',
      '573,0',
      '574,0',
      '575,0',
    ].join('\n');
    const doc = makeDoc(text, { wordAt: 'pd' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 1, character: 2 } as never);
    expect(items.find(i => i.label === 'pDim')).toBeDefined();
  });

  it('excludes TI keywords and builtin functions from variable suggestions', () => {
    const text = [
      '572,1',
      'If (CellGetN("C","D") > 0); EndIf;',
      '573,0',
      '574,0',
      '575,0',
    ].join('\n');
    const doc = makeDoc(text, { wordAt: 'if' }) as never;
    const items = provider.provideCompletionItems(doc, { line: 1, character: 2 } as never);
    expect(items.find(i => String(i.label).toLowerCase() === 'if')).toBeUndefined();
    expect(items.find(i => String(i.label).toLowerCase() === 'cellgetn')).toBeUndefined();
  });
});

describe('TiVariableCompletionProvider — per-document parse cache', () => {
  /** Doc with a stable identity (for the WeakMap key), a mutable `version`,
   *  and a getText spy so we can observe whether the parse re-ran. */
  function makeVersionedDoc(initial: string) {
    const state = { text: initial, version: 1 };
    const getText = vi.fn((range?: unknown) => {
      // provideCompletionItems calls getText(wordRange) for the typed word;
      // getTiVariableParse calls getText() (no arg) for the full content.
      if (range) { return 'va'; }
      return state.text;
    });
    const doc = {
      get version() { return state.version; },
      uri: { toString: () => 'file:///proc.pro', fsPath: '/proc.pro' },
      getText,
      getWordRangeAtPosition: () => ({ _word: 'va' }),
      lineAt: (idx: number) => ({ text: state.text.split('\n')[idx] ?? '' }),
    };
    const edit = (next: string) => { state.text = next; state.version += 1; };
    return { doc, getText, edit };
  }

  it('reuses the parse for two calls at the same version (identity + single content read)', () => {
    const { doc, getText } = makeVersionedDoc('572,1\nvarAlpha := 1;\n573,0\n574,0\n575,0');

    const first = getTiVariableParse(doc as never);
    const second = getTiVariableParse(doc as never);

    // Same version → identical parse object returned (memoized, not recomputed).
    expect(second).toBe(first);
    // getText() (no-arg, full content) ran exactly once across both calls.
    const contentReads = getText.mock.calls.filter(c => c[0] === undefined);
    expect(contentReads.length).toBe(1);
    expect(first.identifiers.has('varAlpha')).toBe(true);
  });

  it('recomputes after an edit (version bump) and yields updated variables', () => {
    const { doc, edit } = makeVersionedDoc('572,1\nvarAlpha := 1;\n573,0\n574,0\n575,0');

    const before = getTiVariableParse(doc as never);
    expect(before.identifiers.has('varAlpha')).toBe(true);
    expect(before.identifiers.has('varBeta')).toBe(false);

    edit('572,1\nvarBeta := 2;\n573,0\n574,0\n575,0');

    const after = getTiVariableParse(doc as never);
    expect(after).not.toBe(before);
    expect(after.identifiers.has('varBeta')).toBe(true);
    expect(after.identifiers.has('varAlpha')).toBe(false);
  });

  it('provideCompletionItems reflects edited text after a version bump', () => {
    const provider = new TiVariableCompletionProvider();
    const { doc, edit } = makeVersionedDoc('572,1\nvarAlpha := 1;\n573,0\n574,0\n575,0');

    const first = provider.provideCompletionItems(doc as never, { line: 1, character: 2 } as never);
    expect(first.find(i => i.label === 'varAlpha')).toBeDefined();

    edit('572,1\nvarAmount := 2;\n573,0\n574,0\n575,0');

    const second = provider.provideCompletionItems(doc as never, { line: 1, character: 2 } as never);
    expect(second.find(i => i.label === 'varAmount')).toBeDefined();
    expect(second.find(i => i.label === 'varAlpha')).toBeUndefined();
  });
});

describe('TiContextCompletionProvider', () => {
  const provider = new TiContextCompletionProvider();
  const mockFetchNames = fetchNames as ReturnType<typeof vi.fn>;

  beforeEach(() => { mockFetchNames.mockReset(); });

  it('returns undefined when line starts with comment', async () => {
    const doc = {
      getText: () => '',
      uri: { fsPath: '' },
      getWordRangeAtPosition: () => undefined,
      lineAt: () => ({ text: '# comment line' }),
    } as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 5 } as never, {} as never);
    expect(result).toBeUndefined();
  });

  it('returns undefined when getTiContextEndpoint yields null', async () => {
    const doc = {
      getText: () => '',
      uri: { fsPath: '' },
      getWordRangeAtPosition: () => undefined,
      lineAt: () => ({ text: 'plain text' }),
    } as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 5 } as never, {} as never);
    expect(result).toBeUndefined();
  });

  it('returns CompletionItems for known TI context (CellGetN cube arg)', async () => {
    mockFetchNames.mockResolvedValue(['SalesCube', 'PlanCube']);
    const lineText = "CellGetN('";
    const doc = {
      getText: () => '',
      uri: { fsPath: '' },
      getWordRangeAtPosition: () => undefined,
      lineAt: () => ({ text: lineText }),
    } as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: lineText.length } as never, {} as never);
    expect(result).toBeDefined();
    expect(result!.map(i => i.label)).toEqual(['SalesCube', 'PlanCube']);
    expect(result![0].detail).toBe('TM1 Cube');
  });

  it('returns undefined when fetchNames yields empty list', async () => {
    mockFetchNames.mockResolvedValue([]);
    const lineText = "CellGetN('";
    const doc = {
      getText: () => '',
      uri: { fsPath: '' },
      getWordRangeAtPosition: () => undefined,
      lineAt: () => ({ text: lineText }),
    } as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: lineText.length } as never, {} as never);
    expect(result).toBeUndefined();
  });
});

describe('Tm1CompletionProvider (keyword trigger)', () => {
  const provider = new Tm1CompletionProvider();
  const mockFetchNames = fetchNames as ReturnType<typeof vi.fn>;

  beforeEach(() => { mockFetchNames.mockReset(); });

  it('returns undefined when no word at cursor', async () => {
    const doc = makeDoc('') as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 0 } as never, {} as never);
    expect(result).toBeUndefined();
  });

  it('returns undefined when typed word too short', async () => {
    const doc = makeDoc('c', { wordAt: 'c' }) as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 1 } as never, {} as never);
    expect(result).toBeUndefined();
  });

  it('returns undefined when no keyword prefix matches', async () => {
    const doc = makeDoc('xyz', { wordAt: 'xyz' }) as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 3 } as never, {} as never);
    expect(result).toBeUndefined();
  });

  it('triggers Cubes endpoint when typed word starts with "cube"', async () => {
    mockFetchNames.mockResolvedValue(['SalesCube']);
    const doc = makeDoc('cube', { wordAt: 'cube' }) as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 4 } as never, {} as never);
    expect(result).toBeDefined();
    expect(mockFetchNames).toHaveBeenCalledWith('Cubes', expect.anything());
    expect(result![0].label).toBe('SalesCube');
    expect(result![0].detail).toBe('TM1 Cube');
  });

  it('returns undefined when fetchNames yields empty', async () => {
    mockFetchNames.mockResolvedValue([]);
    const doc = makeDoc('proc', { wordAt: 'proc' }) as never;
    const result = await provider.provideCompletionItems(doc, { line: 0, character: 4 } as never, {} as never);
    expect(result).toBeUndefined();
  });
});
