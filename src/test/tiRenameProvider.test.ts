import { describe, it, expect } from 'vitest';
import { TiRenameProvider } from '../providers/tiRenameProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a minimal mock TextDocument from a multi-line string.
 * Implements just the parts that TiRenameProvider uses.
 */
function makeDoc(text: string) {
  const lines = text.split('\n');
  return {
    lineCount: lines.length,
    lineAt: (idx: number) => ({ text: lines[idx] ?? '' }),
    uri: { toString: () => 'file:///test.pro', fsPath: '/test.pro' },
    // getWordRangeAtPosition: returns the word's range at the given position
    getWordRangeAtPosition: (pos: { line: number; character: number }, regex?: RegExp) => {
      const line = lines[pos.line] ?? '';
      const re = regex ?? /\w+/;
      // Find word spanning pos.character
      let start = pos.character;
      let end = pos.character;
      const wordRe = new RegExp(re.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(line)) !== null) {
        if (m.index <= pos.character && pos.character <= m.index + m[0].length) {
          start = m.index;
          end = m.index + m[0].length;
          return { startLine: pos.line, startCharacter: start, endLine: pos.line, endCharacter: end,
                   _word: m[0] };
        }
      }
      return undefined;
    },
    getText: (range?: any) => {
      if (!range) { return text; }
      // range has startLine, startCharacter, endLine, endCharacter OR _word
      if (range._word !== undefined) { return range._word; }
      const l = lines[range.startLine] ?? '';
      return l.slice(range.startCharacter, range.endCharacter);
    },
  };
}

const provider = new TiRenameProvider();

// ─── prepareRename ────────────────────────────────────────────────────────────

describe('TiRenameProvider.prepareRename', () => {
  it('accepts a regular variable name', () => {
    const doc = makeDoc('vMyVar = 1;');
    const pos = { line: 0, character: 2 };
    expect(() => provider.prepareRename(doc as any, pos as any)).not.toThrow();
    const result = provider.prepareRename(doc as any, pos as any) as any;
    expect(result.placeholder).toBe('vMyVar');
  });

  it('rejects a built-in function name', () => {
    const doc = makeDoc('DimensionCreate = 1;');
    const pos = { line: 0, character: 3 };
    expect(() => provider.prepareRename(doc as any, pos as any)).toThrow();
  });

  it('rejects TI keyword IF', () => {
    const doc = makeDoc('IF(x = 1);');
    const pos = { line: 0, character: 0 };
    expect(() => provider.prepareRename(doc as any, pos as any)).toThrow();
  });

  it('rejects ProcessError keyword', () => {
    const doc = makeDoc('ProcessError;');
    const pos = { line: 0, character: 3 };
    expect(() => provider.prepareRename(doc as any, pos as any)).toThrow();
  });

  it('returns undefined when cursor is not on a word', () => {
    const doc = makeDoc('vX = 1;');
    // Simulate no word at position (getWordRangeAtPosition returns undefined)
    const emptyDoc = { ...doc, getWordRangeAtPosition: () => undefined };
    expect(() => provider.prepareRename(emptyDoc as any, { line: 0, character: 0 } as any)).toThrow();
  });
});

// ─── provideRenameEdits ───────────────────────────────────────────────────────

describe('TiRenameProvider.provideRenameEdits', () => {
  it('renames all occurrences of a variable across the document', () => {
    const doc = makeDoc([
      'vCounter = 0;',
      'vCounter = vCounter + 1;',
      'Result = vCounter;',
    ].join('\n'));
    const pos = { line: 0, character: 2 };
    const edit = provider.provideRenameEdits(doc as any, pos as any, 'nCounter') as any;
    expect(edit).toBeDefined();
    const replacements = edit._allReplacements();
    // 4 occurrences: line 0 col 0, line 1 col 0, line 1 col 11, line 2 col 9
    expect(replacements).toHaveLength(4);
    expect(replacements.every((r: any) => r.newText === 'nCounter')).toBe(true);
  });

  it('renames case-insensitively (TI is case-insensitive)', () => {
    const doc = makeDoc([
      'vx = 1;',
      'VX = VX + 1;',
      'y = Vx;',
    ].join('\n'));
    const pos = { line: 0, character: 0 };
    const edit = provider.provideRenameEdits(doc as any, pos as any, 'vNewName') as any;
    expect(edit).toBeDefined();
    const replacements = edit._allReplacements();
    // line 0: vx, line 1: VX VX, line 2: Vx — 4 total
    expect(replacements).toHaveLength(4);
  });

  it('skips occurrences inside string literals', () => {
    const doc = makeDoc("vFoo = 'vFoo is the name';");
    const pos = { line: 0, character: 0 };
    const edit = provider.provideRenameEdits(doc as any, pos as any, 'vBar') as any;
    expect(edit).toBeDefined();
    const replacements = edit._allReplacements();
    // Only the assignment target is renamed, not the occurrence inside the string
    expect(replacements).toHaveLength(1);
    expect(replacements[0].range.startCharacter).toBe(0);
  });

  it('skips occurrences inside line comments', () => {
    const doc = makeDoc([
      'vFoo = 1;',
      '# vFoo is used here',
      'y = vFoo;',
    ].join('\n'));
    const pos = { line: 0, character: 0 };
    const edit = provider.provideRenameEdits(doc as any, pos as any, 'vBar') as any;
    const replacements = edit._allReplacements();
    // 2 real occurrences (line 0 and line 2), comment skipped
    expect(replacements).toHaveLength(2);
  });

  it('returns undefined for empty new name', () => {
    const doc = makeDoc('vFoo = 1;');
    const pos = { line: 0, character: 0 };
    expect(provider.provideRenameEdits(doc as any, pos as any, '')).toBeUndefined();
    expect(provider.provideRenameEdits(doc as any, pos as any, '   ')).toBeUndefined();
  });

  it('returns undefined when new name starts with a digit', () => {
    const doc = makeDoc('vFoo = 1;');
    const pos = { line: 0, character: 0 };
    expect(provider.provideRenameEdits(doc as any, pos as any, '1bad')).toBeUndefined();
  });

  it('returns undefined when new name is a built-in function', () => {
    const doc = makeDoc('vFoo = 1;');
    const pos = { line: 0, character: 0 };
    expect(provider.provideRenameEdits(doc as any, pos as any, 'CellGetN')).toBeUndefined();
  });

  it('returns undefined when renaming a built-in function', () => {
    const doc = makeDoc('DimensionCreate = 1;');
    const pos = { line: 0, character: 3 };
    expect(provider.provideRenameEdits(doc as any, pos as any, 'NewName')).toBeUndefined();
  });

  it('does not rename partial word matches (word boundary)', () => {
    const doc = makeDoc([
      'vFoo = 1;',
      'vFooBar = 2;',
      'y = vFoo;',
    ].join('\n'));
    const pos = { line: 0, character: 0 };
    const edit = provider.provideRenameEdits(doc as any, pos as any, 'vBaz') as any;
    const replacements = edit._allReplacements();
    // vFooBar must not be touched — only vFoo (2 occurrences)
    expect(replacements).toHaveLength(2);
    expect(replacements.every((r: any) => r.range.endCharacter - r.range.startCharacter === 4)).toBe(true);
  });
});
