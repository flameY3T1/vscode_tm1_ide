import { describe, it, expect } from 'vitest';
import {
  findBracketBlocks,
  splitEntries,
  classifyEntry,
  parseBracketContent,
} from '../../elementQualifier/cellRefParser';

describe('findBracketBlocks', () => {
  it('returns empty for text without brackets', () => {
    expect(findBracketBlocks('foo bar')).toEqual([]);
  });

  it('captures a single block with content + offsets', () => {
    const text = `xx['Elem'] = 1;`;
    const blocks = findBracketBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ start: 2, end: 9, content: `'Elem'` });
  });

  it('captures multiple top-level blocks', () => {
    const text = `['A'] = ['B'];`;
    const blocks = findBracketBlocks(text);
    expect(blocks.map(b => b.content)).toEqual([`'A'`, `'B'`]);
  });

  it('ignores brackets inside string literals', () => {
    const text = `['A'] = '[X]';`;
    const blocks = findBracketBlocks(text);
    expect(blocks.map(b => b.content)).toEqual([`'A'`]);
  });

  it('ignores brackets inside line comments', () => {
    const text = `# ['NotABlock']\n['Real'];`;
    const blocks = findBracketBlocks(text);
    expect(blocks.map(b => b.content)).toEqual([`'Real'`]);
  });

  it('handles multi-line block content', () => {
    const text = `['A',\n 'B',\n 'C']`;
    const blocks = findBracketBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe(`'A',\n 'B',\n 'C'`);
  });
});

describe('splitEntries', () => {
  it('splits by top-level commas', () => {
    expect(splitEntries(`'A','B','C'`)).toEqual([`'A'`, `'B'`, `'C'`]);
  });

  it('does not split inside sets', () => {
    expect(splitEntries(`'D':{'A','B'},'X'`)).toEqual([`'D':{'A','B'}`, `'X'`]);
  });

  it('does not split inside string literals', () => {
    expect(splitEntries(`'A,with,commas','B'`)).toEqual([`'A,with,commas'`, `'B'`]);
  });

  it('trims whitespace', () => {
    expect(splitEntries(`  'A' ,  'B'  `)).toEqual([`'A'`, `'B'`]);
  });

  it('drops empty entries', () => {
    expect(splitEntries(`'A',,'B'`)).toEqual([`'A'`, `'B'`]);
  });
});

describe('classifyEntry', () => {
  it('classifies qualified ref', () => {
    expect(classifyEntry(`'Dim':'Elem'`)).toEqual({
      kind: 'qualified', dim: 'Dim', elem: 'Elem', raw: `'Dim':'Elem'`,
    });
  });

  it('classifies qualified set', () => {
    expect(classifyEntry(`'Dim':{'A','B'}`)).toEqual({
      kind: 'qualifiedSet', dim: 'Dim', elems: ['A', 'B'], raw: `'Dim':{'A','B'}`,
    });
  });

  it('classifies bare element', () => {
    expect(classifyEntry(`'Elem'`)).toEqual({
      kind: 'bare', elem: 'Elem', raw: `'Elem'`,
    });
  });

  it('classifies bare set', () => {
    expect(classifyEntry(`{'A','B','C'}`)).toEqual({
      kind: 'bareSet', elems: ['A', 'B', 'C'], raw: `{'A','B','C'}`,
    });
  });

  it('classifies !var', () => {
    expect(classifyEntry(`!dim_Linie`)).toEqual({
      kind: 'var', name: `!dim_Linie`, raw: `!dim_Linie`,
    });
  });

  it('falls back to unknown for unparseable input', () => {
    expect(classifyEntry(`Foo:Bar`)).toEqual({ kind: 'unknown', raw: `Foo:Bar` });
  });
});

describe('parseBracketContent integration', () => {
  it('parses a mixed cell-ref', () => {
    const entries = parseBracketContent(`'BareA', 'Dim':'X', 'BareB'`);
    expect(entries.map(e => e.kind)).toEqual(['bare', 'qualified', 'bare']);
  });
});
