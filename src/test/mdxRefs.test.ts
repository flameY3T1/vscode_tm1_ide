import { describe, it, expect } from 'vitest';
import { extractElementRefs, extractCalculatedMemberNames } from '../mdx/mdxRefs';

describe('extractCalculatedMemberNames', () => {
  it('captures single WITH MEMBER', () => {
    const set = extractCalculatedMemberNames('WITH MEMBER [Measures].[Calc] AS 1 SELECT …');
    expect(Array.from(set)).toEqual(['Calc']);
  });

  it('captures multiple WITH MEMBER', () => {
    const src = 'WITH MEMBER [Measures].[A] AS 1 MEMBER [Measures].[B] AS 2 SELECT …';
    const set = extractCalculatedMemberNames(src);
    expect(Array.from(set).sort()).toEqual(['A', 'B']);
  });

  it('no WITH MEMBER → empty set', () => {
    expect(extractCalculatedMemberNames('SELECT {} ON 0 FROM [C]').size).toBe(0);
  });
});

describe('extractElementRefs', () => {
  it('single [Dim].[Elem] → one ref', () => {
    const refs = extractElementRefs('[Month].[Jan]');
    expect(refs).toEqual([{ dim: 'Month', element: 'Jan', offset: 0, length: 13 }]);
  });

  it('[Dim].[Members] → no ref (member property)', () => {
    expect(extractElementRefs('[Month].[Members]')).toEqual([]);
  });

  it('[Dim].[Children] → no ref (member property)', () => {
    expect(extractElementRefs('[Month].[Children]')).toEqual([]);
  });

  it('WITH MEMBER name is excluded', () => {
    const src = 'WITH MEMBER [Measures].[Calc] AS 1 SELECT [Measures].[Calc]';
    expect(extractElementRefs(src)).toEqual([]);
  });

  it('DESCENDANTS([All], 1) → no ref (no dim.elem pattern)', () => {
    expect(extractElementRefs('DESCENDANTS([All], 1)')).toEqual([]);
  });

  it('multiple refs with correct offsets', () => {
    const src = 'SELECT {[Month].[Jan],[Product].[Car]} ON 0';
    const refs = extractElementRefs(src);
    expect(refs).toHaveLength(2);
    expect(refs[0].dim).toBe('Month');
    expect(refs[0].element).toBe('Jan');
    expect(refs[0].offset).toBe(8); // position of '['
    expect(src.slice(refs[0].offset, refs[0].offset + refs[0].length)).toBe('[Month].[Jan]');
    expect(refs[1].dim).toBe('Product');
    expect(refs[1].element).toBe('Car');
  });

  it('followed by ( → treated as function call, not ref', () => {
    expect(extractElementRefs('[Month].[LAG](1)')).toEqual([]);
  });

  it('case-insensitive member-property check', () => {
    expect(extractElementRefs('[Month].[MEMBERS]')).toEqual([]);
    expect(extractElementRefs('[Month].[members]')).toEqual([]);
  });

  it('MEMBER token outside WITH-clause is NOT treated as calc-member declaration', () => {
    // A MEMBER keyword appearing after SELECT (not in the WITH clause) must
    // not cause the element name to be added to calcNames and suppress real refs.
    // Old bug: extractCalculatedMemberNames scanned the whole text, so a stray
    // "MEMBER [Measures].[Jan]" after SELECT would add 'Jan' to calcNames and
    // suppress any [Month].[Jan] real ref.
    const src = 'SELECT [Month].[Jan] ON 0 FROM [C] -- MEMBER [Measures].[Jan]';
    const refs = extractElementRefs(src);
    // [Month].[Jan] must survive; 'Jan' must NOT be in calcNames
    expect(refs.some(r => r.dim === 'Month' && r.element === 'Jan')).toBe(true);
    // extractCalculatedMemberNames must return empty (MEMBER is after SELECT)
    const calc = extractCalculatedMemberNames(src);
    expect(calc.size).toBe(0);
  });

  it('calc-member name colliding with a real dim name only suppresses the element side', () => {
    // WITH MEMBER [Measures].[Sales] AS 1 must NOT suppress a real ref to [Sales].[Q1].
    const src = 'WITH MEMBER [Measures].[Sales] AS 1 SELECT [Sales].[Q1] ON 0 FROM [C]';
    const refs = extractElementRefs(src);
    expect(refs.map(r => `${r.dim}.${r.element}`)).toEqual(['Sales.Q1']);
  });

  // The notation that the cube viewer and the runner generate. It carries NO
  // alternate hierarchy: leaving `hier` set switched off the "dimension
  // unknown" branch in the caller — for every generated statement (finding D3).
  it('3-segment with the default hierarchy carries no `hier`', () => {
    const refs = extractElementRefs('[Jahre].[Jahre].[2025]');
    expect(refs).toEqual([{ dim: 'Jahre', element: '2025', offset: 0, length: 22 }]);
  });

  it('`]]` inside a name belongs to the element, not to its end', () => {
    const src = '{[Dim select].[a]]b]}';
    const refs = extractElementRefs(src);
    expect(refs).toEqual([{ dim: 'Dim select', element: 'a]b', offset: 1, length: 19 }]);
    expect(src.slice(1, 1 + 19)).toBe('[Dim select].[a]]b]');
  });

  it('a reference inside a `--` comment is not checked', () => {
    const refs = extractElementRefs('SELECT {[A].[A].[x]} ON 0 FROM [C] -- [Foo].[Bar]');
    expect(refs.map(r => `${r.dim}.${r.element}`)).toEqual(['A.x']);
  });

  it('a reference inside a block comment is not checked', () => {
    const refs = extractElementRefs('SELECT /* [Foo].[Bar] */ {[A].[A].[x]} ON 0 FROM [C]');
    expect(refs.map(r => `${r.dim}.${r.element}`)).toEqual(['A.x']);
  });

  it('a reference inside a string literal is not checked', () => {
    const refs = extractElementRefs("SELECT {TM1FILTERBYPATTERN([A].[A].MEMBERS, '[Foo].[Bar]')} ON 0 FROM [C]");
    expect(refs).toEqual([]);
  });

  it('3-segment with member property → skipped', () => {
    expect(extractElementRefs('[Jahre].[Jahre].[Members]')).toEqual([]);
  });

  it('3-segment followed by ( → function call, skipped', () => {
    expect(extractElementRefs('[Jahre].[Jahre].[Lag](1)')).toEqual([]);
  });

  it('[Dim].[Hier].MEMBERS → no ref (second bracket is the hierarchy)', () => {
    expect(extractElementRefs('SELECT {[Jahre].[Alternativ].MEMBERS} ON 0 FROM [C]')).toEqual([]);
  });

  it('[Dim].[Hier].Children → no ref, whatever the case', () => {
    expect(extractElementRefs('[Jahre].[Alternativ].Children')).toEqual([]);
  });

  it('alternate hierarchy is reported, not swallowed', () => {
    const refs = extractElementRefs('[Region].[Vertrieb].[Nord]');
    expect(refs).toEqual([{ dim: 'Region', hier: 'Vertrieb', element: 'Nord', offset: 0, length: 26 }]);
  });
});
