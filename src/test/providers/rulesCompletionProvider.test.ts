import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../providers/fetchNames', () => ({
  fetchNames: vi.fn(),
  invalidateCache: vi.fn(),
  warmCache: vi.fn(),
}));

import {
  RulesFunctionCompletionProvider,
  RulesKeywordCompletionProvider,
  RulesServerCompletionProvider,
} from '../../providers/rulesCompletionProvider';
import { fetchNames } from '../../providers/fetchNames';

function makeDoc(lineText: string, wordAt?: string) {
  return {
    getText: () => wordAt ?? '',
    uri: { fsPath: '' },
    getWordRangeAtPosition: () => wordAt !== undefined ? { _word: wordAt } : undefined,
    lineAt: () => ({ text: lineText }),
  } as never;
}

describe('RulesFunctionCompletionProvider', () => {
  const provider = new RulesFunctionCompletionProvider();

  it('constructor populates rules-only function items', () => {
    const items = provider.provideCompletionItems(makeDoc(''), { line: 0, character: 0 } as never);
    expect(items.length).toBeGreaterThan(20);
  });

  it('skips comment lines (# prefix)', () => {
    const items = provider.provideCompletionItems(makeDoc('# comment line'), { line: 0, character: 5 } as never);
    expect(items).toEqual([]);
  });

  it('returns full list when no word at cursor', () => {
    const items = provider.provideCompletionItems(makeDoc('plain text'), { line: 0, character: 0 } as never);
    expect(items.length).toBeGreaterThan(0);
  });

  it('returns empty array when typed length is 0 (wordAt empty)', () => {
    const items = provider.provideCompletionItems(makeDoc('plain', ''), { line: 0, character: 0 } as never);
    expect(items).toEqual([]);
  });

  it('filters by infix match on label (case-insensitive)', () => {
    const items = provider.provideCompletionItems(makeDoc('cellget', 'cellget'), { line: 0, character: 7 } as never);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect((item.label as string).toLowerCase().includes('cellget')).toBe(true);
    }
  });

  it('matches inner substring (infix, not prefix)', () => {
    const items = provider.provideCompletionItems(makeDoc('attr', 'attr'), { line: 0, character: 4 } as never);
    expect(items.find(i => (i.label as string).toLowerCase().includes('attr'))).toBeDefined();
  });

  it('does NOT set filterText on function items (preserves VS Code CamelCase match)', () => {
    const items = provider.provideCompletionItems(makeDoc(''), { line: 0, character: 0 } as never);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.filterText).toBeUndefined();
    }
  });

  it('does NOT include non-rules functions like ExecuteProcess', () => {
    const items = provider.provideCompletionItems(makeDoc('exec', 'exec'), { line: 0, character: 4 } as never);
    expect(items.find(i => (i.label as string).toLowerCase() === 'executeprocess')).toBeUndefined();
  });
});

describe('RulesKeywordCompletionProvider', () => {
  const provider = new RulesKeywordCompletionProvider();

  it('skips comment lines', () => {
    const items = provider.provideCompletionItems(makeDoc('# x'), { line: 0, character: 2 } as never);
    expect(items).toEqual([]);
  });

  it('returns empty when no typed prefix', () => {
    const items = provider.provideCompletionItems(makeDoc('plain'), { line: 0, character: 0 } as never);
    expect(items).toEqual([]);
  });

  it('matches FEEDERS by prefix', () => {
    const items = provider.provideCompletionItems(makeDoc('feed', 'feed'), { line: 0, character: 4 } as never);
    expect(items.find(i => i.label === 'FEEDERS')).toBeDefined();
  });

  it('matches SKIPCHECK by prefix', () => {
    const items = provider.provideCompletionItems(makeDoc('skip', 'skip'), { line: 0, character: 4 } as never);
    expect(items.find(i => i.label === 'SKIPCHECK')).toBeDefined();
  });

  it('cell-reference snippet matches typed "cell"', () => {
    const items = provider.provideCompletionItems(makeDoc('cell', 'cell'), { line: 0, character: 4 } as never);
    expect(items.find(i => i.label === "['Dim':'Elem']")).toBeDefined();
  });
});

describe('RulesServerCompletionProvider', () => {
  const provider = new RulesServerCompletionProvider();
  const mockFetchNames = fetchNames as ReturnType<typeof vi.fn>;

  beforeEach(() => { mockFetchNames.mockReset(); });

  it('skips comment lines', async () => {
    const result = await provider.provideCompletionItems(makeDoc('# comment'), { line: 0, character: 5 } as never);
    expect(result).toBeUndefined();
  });

  it('suggests cubes after DB(', async () => {
    mockFetchNames.mockResolvedValue(['SalesCube']);
    const lineText = "DB('";
    const result = await provider.provideCompletionItems(
      makeDoc(lineText),
      { line: 0, character: lineText.length } as never,
    );
    expect(mockFetchNames).toHaveBeenCalledWith('Cubes', expect.anything());
    expect(result![0].label).toBe('SalesCube');
    expect(result![0].detail).toBe('TM1 Cube');
  });

  it('suggests dimensions after [', async () => {
    mockFetchNames.mockResolvedValue(['Region', 'Product']);
    const lineText = "['";
    const result = await provider.provideCompletionItems(
      makeDoc(lineText),
      { line: 0, character: lineText.length } as never,
    );
    expect(mockFetchNames).toHaveBeenCalledWith('Dimensions', expect.anything());
    expect(result!.map(i => i.label)).toEqual(['Region', 'Product']);
    expect(result![0].detail).toBe('TM1 Dimension');
  });

  it('returns undefined for unmatched context', async () => {
    const result = await provider.provideCompletionItems(
      makeDoc('plain text'),
      { line: 0, character: 5 } as never,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when fetchNames yields empty', async () => {
    mockFetchNames.mockResolvedValue([]);
    const lineText = "DB('";
    const result = await provider.provideCompletionItems(
      makeDoc(lineText),
      { line: 0, character: lineText.length } as never,
    );
    expect(result).toBeUndefined();
  });
});
