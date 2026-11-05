import { describe, it, expect } from 'vitest';
import { TiReferencesProvider } from '../providers/tiReferencesProvider';

function makeDoc(text: string) {
  const lines = text.split('\n');
  const uri = { toString: () => 'file:///t.pro', fsPath: '/t.pro' };
  return {
    lineCount: lines.length,
    lineAt: (idx: number) => ({ text: lines[idx] ?? '' }),
    getText: (range?: any) => {
      if (!range) return text;
      const line = lines[range.startLine] ?? '';
      return line.substring(range.startCharacter, range.endCharacter);
    },
    uri,
    getWordRangeAtPosition: (pos: { line: number; character: number }, regex: RegExp) => {
      const line = lines[pos.line] ?? '';
      const wordRe = new RegExp(regex.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(line)) !== null) {
        if (m.index <= pos.character && pos.character <= m.index + m[0].length) {
          return {
            startLine: pos.line, startCharacter: m.index,
            endLine: pos.line, endCharacter: m.index + m[0].length,
          };
        }
      }
      return undefined;
    },
  } as any;
}

const provider = new TiReferencesProvider();
const refs = (text: string, line: number, character: number) =>
  provider.provideReferences(
    makeDoc(text),
    { line, character } as any,
    { includeDeclaration: true } as any,
  );

describe('TiReferencesProvider', () => {
  it('returns all occurrences of identifier across lines', () => {
    const text = [
      "sDim = 'Sales';",
      "sCube = sDim;",
      "Result = sDim;",
    ].join('\n');
    const result = refs(text, 0, 1) as any[];
    expect(result.length).toBe(3);
    expect(result.every(r => r.uri && r.range)).toBe(true);
  });

  it('returns [] when cursor not on an identifier', () => {
    const text = "x = 1;";
    const result = refs(text, 0, 5) as any[];
    expect(result).toEqual([]);
  });

  it('excludes occurrences inside string literals', () => {
    const text = [
      "sDim = 'Foo';",
      "msg = 'sDim is the variable';",
      "Result = sDim;",
    ].join('\n');
    const result = refs(text, 0, 1) as any[];
    expect(result.length).toBe(2);
  });

  it('excludes occurrences inside line comments', () => {
    const text = [
      "sDim = 'A';",
      "# sDim is documented here",
      "x = sDim;",
    ].join('\n');
    const result = refs(text, 0, 1) as any[];
    expect(result.length).toBe(2);
  });

  it('handles unicode identifiers (Umlaut)', () => {
    const text = [
      "größe = 1;",
      "y = größe + 2;",
    ].join('\n');
    const result = refs(text, 0, 1) as any[];
    expect(result.length).toBe(2);
  });

  it('returns Location with the document uri', () => {
    const text = "v = v + 1;";
    const result = refs(text, 0, 0) as any[];
    expect(result.length).toBe(2);
    expect(result[0].uri.fsPath).toBe('/t.pro');
  });
});
