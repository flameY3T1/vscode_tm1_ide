import { describe, it, expect } from 'vitest';

import { buildCellPicklistMdx } from '../../cubeViewer/cellPicklistMdxPure';

/**
 * Task 15: the single-cell query. Measured 2026-08-13 (11.8): ONE cell
 * costs 1–2 ms, 417 cells in one cellset 12.5 s. The control cube is
 * not expensive per cell but with the cellset SIZE — that is why
 * this test mainly checks one thing: that no more than one cell is ever
 * addressed here.
 */
describe('buildCellPicklistMdx', () => {
  it('addresses exactly ONE cell — one tuple on each of both axes', () => {
    const mdx = buildCellPicklistMdx('Plan', ['Region', 'Monat', 'Jahr'], ['Nord', 'Jan', '2026']);
    expect(mdx).toBe(
      'SELECT {[Region].[Region].[Nord]} ON 0, {[Monat].[Monat].[Jan]} ON 1 '
      + 'FROM [}PickList_Plan] '
      + 'WHERE ([Jahr].[Jahr].[2026],[}PickList].[}PickList].[Value])',
    );
  });

  it('puts every further dimension into the WHERE slicer', () => {
    const mdx = buildCellPicklistMdx(
      'Plan', ['A', 'B', 'C', 'D'], ['a', 'b', 'c', 'd'],
    );
    expect(mdx).toContain('WHERE ([C].[C].[c],[D].[D].[d],[}PickList].[}PickList].[Value])');
  });

  it('copes with a one-dimensional cube (only ON 0)', () => {
    const mdx = buildCellPicklistMdx('Mini', ['A'], ['a']);
    expect(mdx).toBe(
      'SELECT {[A].[A].[a]} ON 0 FROM [}PickList_Mini] WHERE ([}PickList].[}PickList].[Value])',
    );
  });

  it('doubles ] in names — MDX escape', () => {
    const mdx = buildCellPicklistMdx('C]ube', ['D]im', 'X'], ['E]lem', 'x']);
    expect(mdx).toContain('[D]]im].[D]]im].[E]]lem]');
    expect(mdx).toContain('[}PickList_C]]ube]');
  });

  it('returns null when dimensions and coordinates do not match', () => {
    // Without this guard, a slicer would arise that does NOT name a dimension —
    // TM1 would put its default element there and answer with the
    // definition of a DIFFERENT cell, which looks perfectly valid.
    expect(buildCellPicklistMdx('Plan', ['A', 'B'], ['a'])).toBeNull();
    expect(buildCellPicklistMdx('Plan', [], [])).toBeNull();
  });

  it('returns null when a coordinate is empty', () => {
    expect(buildCellPicklistMdx('Plan', ['A', 'B'], ['a', ''])).toBeNull();
  });
});

describe('buildCellPicklistMdx — alternate hierarchy keys', () => {
  it('names the hierarchy of a `dim:hier` key', () => {
    expect(buildCellPicklistMdx('C', ['D:Alt', 'E'], ['GroupA', 'x'])).toBe(
      'SELECT {[D].[Alt].[GroupA]} ON 0, {[E].[E].[x]} ON 1 FROM [}PickList_C] WHERE ([}PickList].[}PickList].[Value])',
    );
  });
});
