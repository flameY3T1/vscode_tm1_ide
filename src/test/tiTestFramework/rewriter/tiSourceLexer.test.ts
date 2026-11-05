import { describe, it, expect } from 'vitest';
import { findCallSites, offsetToLineCol, splitArgs } from '../../../tiTestFramework/rewriter/tiSourceLexer';

describe('findCallSites', () => {
  it('finds a single call', () => {
    const src = `CellPutN(100, 'Cube', 'A');`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('CellPutN');
    expect(sites[0].argString).toBe(`100, 'Cube', 'A'`);
    expect(sites[0].start).toBe(0);
    expect(sites[0].end).toBe(`CellPutN(100, 'Cube', 'A')`.length);
  });

  it('finds multiple top-level calls', () => {
    const src = `CellPutN(1,'C','a'); CellPutS('x','C','a');`;
    const sites = findCallSites(src);
    expect(sites.map((s) => s.name)).toEqual(['CellPutN', 'CellPutS']);
  });

  it('does NOT yield nested calls (only top-level)', () => {
    const src = `CellPutN(NumberToString(42), 'C', 'a');`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('CellPutN');
    expect(sites[0].argString).toContain('NumberToString(42)');
  });

  it('skips identifier inside string literal', () => {
    const src = `s = 'CellPutN(1, 2, 3)';`;
    expect(findCallSites(src)).toEqual([]);
  });

  it('handles doubled-quote escape inside string', () => {
    const src = `s = 'it''s'; CellPutN(1,'C','a');`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('CellPutN');
  });

  it('skips identifier inside line comment (#)', () => {
    const src = `# CellPutN(1, 'C', 'a');\nCellPutS('x','C','a');`;
    const sites = findCallSites(src);
    expect(sites.map((s) => s.name)).toEqual(['CellPutS']);
  });

  it('skips identifier inside line comment (//)', () => {
    const src = `// CellPutN(1, 'C', 'a');\nCellPutS('x','C','a');`;
    const sites = findCallSites(src);
    expect(sites.map((s) => s.name)).toEqual(['CellPutS']);
  });

  it('skips identifier inside block comment', () => {
    const src = `/* CellPutN(1, 'C', 'a'); */ CellPutS('x','C','a');`;
    const sites = findCallSites(src);
    expect(sites.map((s) => s.name)).toEqual(['CellPutS']);
  });

  it('handles whitespace between name and paren', () => {
    const src = `CellPutN  (100, 'C', 'a');`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('CellPutN');
  });

  it('handles call spread across pre-joined logical line', () => {
    const src = `CellPutN( 100,    'Cube',  'A',  'B' );`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].argString.trim().startsWith('100')).toBe(true);
  });

  it('returns empty for source with no calls', () => {
    expect(findCallSites('x = 1 + 2;')).toEqual([]);
  });

  it('finds chain of top-level calls', () => {
    const src = `CellPutN(1,'C','a'); IF(x); CellPutS('y','C','a'); ENDIF;`;
    const sites = findCallSites(src);
    // ENDIF has no parens → not a call site (keyword, not function)
    expect(sites.map((s) => s.name)).toEqual(['CellPutN', 'IF', 'CellPutS']);
  });

  it('preserves identifier case', () => {
    const src = `cellputn(1,'C','a'); CELLPUTS('x','C','a');`;
    const sites = findCallSites(src);
    expect(sites[0].name).toBe('cellputn');
    expect(sites[1].name).toBe('CELLPUTS');
  });

  it('handles unbalanced paren by skipping', () => {
    const src = `CellPutN(100, 'C'`;
    expect(findCallSites(src)).toEqual([]);
  });

  it('argument string preserves nested parens content', () => {
    const src = `f(g(1,2), h(3));`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('f');
    expect(sites[0].argString).toBe('g(1,2), h(3)');
  });
});

describe('splitArgs', () => {
  it('splits simple args', () => {
    expect(splitArgs(`1, 'a', 'b'`)).toEqual(['1', "'a'", "'b'"]);
  });

  it('handles nested parens', () => {
    expect(splitArgs(`NumberToString(42), 'C', 'a'`)).toEqual([
      'NumberToString(42)',
      "'C'",
      "'a'",
    ]);
  });

  it('honors string-literal commas', () => {
    expect(splitArgs(`'a, b', 'c, d'`)).toEqual([`'a, b'`, `'c, d'`]);
  });

  it('honors doubled-quote escape', () => {
    expect(splitArgs(`'it''s', 'x'`)).toEqual([`'it''s'`, `'x'`]);
  });

  it('returns empty for empty input', () => {
    expect(splitArgs('')).toEqual([]);
  });

  it('handles single arg', () => {
    expect(splitArgs(`42`)).toEqual(['42']);
  });

  it('trims whitespace per arg', () => {
    expect(splitArgs(`  1 ,  2 , 3  `)).toEqual(['1', '2', '3']);
  });

  it('preserves trailing empty arg', () => {
    expect(splitArgs(`1, ,3`)).toEqual(['1', '', '3']);
  });

  it('handles deep nesting', () => {
    expect(splitArgs(`f(g(h(1,2),3),4), 'x'`)).toEqual([`f(g(h(1,2),3),4)`, `'x'`]);
  });
});

describe('offsetToLineCol', () => {
  it('returns 1:1 at offset 0', () => {
    expect(offsetToLineCol('hello', 0)).toEqual({ line: 1, col: 1 });
  });

  it('advances column for non-newline chars', () => {
    expect(offsetToLineCol('hello', 3)).toEqual({ line: 1, col: 4 });
  });

  it('advances line on newline and resets column', () => {
    const src = 'a\nbc\nd';
    expect(offsetToLineCol(src, 0)).toEqual({ line: 1, col: 1 });
    expect(offsetToLineCol(src, 1)).toEqual({ line: 1, col: 2 });
    expect(offsetToLineCol(src, 2)).toEqual({ line: 2, col: 1 });
    expect(offsetToLineCol(src, 4)).toEqual({ line: 2, col: 3 });
    expect(offsetToLineCol(src, 5)).toEqual({ line: 3, col: 1 });
  });

  it('clamps offset past end of source', () => {
    expect(offsetToLineCol('ab', 100)).toEqual({ line: 1, col: 3 });
  });
});
