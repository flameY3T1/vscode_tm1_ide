import { describe, it, expect } from 'vitest';
import { splitSections, joinSections, type TiSections } from '../../git/sectionMarkers';

const EMPTY: TiSections = { prolog: '', metadata: '', data: '', epilog: '' };

describe('sectionMarkers', () => {
  describe('splitSections (native Code blob)', () => {
    it('reads the server shape: CRLF, capitalized tabs, bare #endregion, empty tabs omitted', () => {
      const blob = '#region Prolog\r\nsP1();\r\nsP2();\r\n#endregion\r\n#region Data\r\nsD1();\r\n#endregion';
      expect(splitSections(blob)).toEqual({ ...EMPTY, prolog: 'sP1();\nsP2();\n', data: 'sD1();\n' });
    });

    it('keeps the user\'s own folds inside a tab as code', () => {
      const blob = [
        '#region Prolog', '#Region: Setup', 'x = 1;', '#EndRegion', '#endregion',
        '#region Metadata', '#Region: Load', 'y = 2;', '#EndRegion', '#endregion',
      ].join('\r\n');
      expect(splitSections(blob)).toEqual({
        ...EMPTY,
        prolog: '#Region: Setup\nx = 1;\n#EndRegion\n',
        metadata: '#Region: Load\ny = 2;\n#EndRegion\n',
      });
    });

    it('survives a fold the user never closed (2 of 366 processes on the test server)', () => {
      const blob = [
        '#region Prolog', '#Region Cube anlegen', 'x = 1;', '#endregion',
        '#region Metadata', 'm;', '#endregion',
      ].join('\r\n');
      expect(splitSections(blob)).toEqual({ ...EMPTY, prolog: '#Region Cube anlegen\nx = 1;\n', metadata: 'm;\n' });
    });

    it('treats a bare #endregion inside a tab as code when no later tab follows it', () => {
      const blob = ['#region Prolog', '#region fold', 'a;', '#endregion', '#endregion', '#region Epilog', 'e;', '#endregion'].join('\n');
      expect(splitSections(blob)).toEqual({ ...EMPTY, prolog: '#region fold\na;\n#endregion\n', epilog: 'e;\n' });
    });

    it('still reads the former layout with named closing markers', () => {
      const old = [
        '#region prolog', 'p;', '#endregion prolog',
        '#region metadata', '', '#endregion metadata',
        '#region data', 'd;', '#endregion data',
        '#region epilog', '', '#endregion epilog',
      ].join('\n');
      expect(splitSections(old)).toEqual({ ...EMPTY, prolog: 'p;', data: 'd;' });
    });

    it('preserves blank lines inside a tab', () => {
      expect(splitSections('#region Data\nline1;\n\nline3;\n#endregion')?.data).toBe('line1;\n\nline3;\n');
    });

    // TM1 11.8's own split on `PATCH {Code}`, measured 2026-10-12: the break
    // before a bare #endregion belongs to the code. Dropping it lost one
    // trailing line per push.
    it.each([
      ['x;', 'x;\n'],
      ['x;\n', 'x;\n'],
      ['x;\n\n', 'x;\n\n'],
      ['x;\n\n\n', 'x;\n\n\n'],
    ])('11.x: tab %j reads back as TM1 11.8 stores it, and stays put on the next round', (tab, stored) => {
      const once = splitSections(joinSections({ ...EMPTY, prolog: tab }))?.prolog;
      expect(once).toBe(stored);
      expect(splitSections(joinSections({ ...EMPTY, prolog: once! }))?.prolog).toBe(stored);
    });

    it('former layout: named closing markers add no break, so none is kept', () => {
      expect(splitSections('#region prolog\np;\n#endregion prolog')?.prolog).toBe('p;');
    });

    it.each([
      ['empty input', ''],
      ['no markers', 'just code;'],
      ['code outside a tab', 'orphan;\n#region Prolog\np;\n#endregion'],
      ['unknown top-level region', '#region Setup\np;\n#endregion'],
      ['tabs out of order', '#region Epilog\ne;\n#endregion\n#region Prolog\np;\n#endregion'],
      ['a tab twice', '#region Prolog\na;\n#endregion\n#region Prolog\nb;\n#endregion'],
      ['an unclosed tab', '#region Prolog\np;'],
      ['a deleted #endregion before the next tab', '#region Prolog\np;\n#region Data\nd;\n#endregion'],
    ])('refuses %s instead of returning empty tabs', (_label, text) => {
      expect(splitSections(text)).toBeUndefined();
    });
  });

  describe('joinSections', () => {
    it('writes the native layout and omits empty tabs', () => {
      expect(joinSections({ prolog: 'p;', metadata: '', data: 'd;', epilog: '' }))
        .toBe('#region Prolog\np;\n#endregion\n#region Data\nd;\n#endregion');
    });

    it('adds no second line break when a tab already ends with one (as the server does)', () => {
      expect(joinSections({ ...EMPTY, prolog: 'p;\n\n' })).toBe('#region Prolog\np;\n\n#endregion');
    });

    it('writes an empty Prolog region for a process without code, so the file stays readable', () => {
      expect(splitSections(joinSections(EMPTY))).toEqual(EMPTY);
    });

    it('v12: always a line break before #endregion, round-trips the trailing newline', () => {
      const sections = { ...EMPTY, prolog: 'p;\n', data: 'd;' };
      expect(joinSections(sections, true))
        .toBe('#region Prolog\np;\n\n#endregion\n#region Data\nd;\n#endregion');
      expect(splitSections(joinSections(sections, true), true)).toEqual(sections);
      // 12 itself sends an empty blob here; an empty file stays refused (see joinSections).
      expect(splitSections(joinSections(EMPTY, true), true)).toEqual(EMPTY);
    });
  });

  it('ignores broken user folds: only the four tab markers are structure', () => {
    const sections: TiSections = {
      prolog: '#Region never closed\nx = 1;',
      metadata: '#EndRegion\ny = 2;',
      data: 'z = 3;\n#endregion',
      epilog: '#region Prolog\nw = 4;\n#EndRegion wrong',
    };
    expect(splitSections(joinSections(sections), true)).toEqual(sections);
    const withBreak = { prolog: `${sections.prolog}\n`, metadata: `${sections.metadata}\n`, data: `${sections.data}\n`, epilog: `${sections.epilog}\n` };
    expect(splitSections(joinSections(withBreak))).toEqual(withBreak);
  });

  it('round-trips all tabs, multi-line and empty mixed', () => {
    const sections: TiSections = { prolog: '', metadata: 'line1\nline2\n\nline4', data: 'single', epilog: '#Region: x\ny;\n#EndRegion' };
    expect(splitSections(joinSections(sections, true), true)).toEqual(sections);
    // 11.x: the file itself round-trips byte for byte.
    const file = joinSections(sections);
    expect(joinSections(splitSections(file)!)).toBe(file);
  });
});
