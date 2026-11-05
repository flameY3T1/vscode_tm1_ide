import { describe, it, expect } from 'vitest';
import { hasAxisElementFilter } from '../webviewClient/cubeViewerMonaco/mdxAxisFilterPure';

describe('hasAxisElementFilter', () => {
  it('returns true when a colDim has element filter with names', () => {
    expect(hasAxisElementFilter(
      ['RowDim1'],
      ['ColDim1'],
      { ColDim1: { kind: 'elements', names: ['X'] } },
    )).toBe(true);
  });

  it('returns false when element filter has empty names array', () => {
    expect(hasAxisElementFilter(
      ['RowDim1'],
      ['ColDim1'],
      { ColDim1: { kind: 'elements', names: [] } },
    )).toBe(false);
  });

  it('returns true when a rowDim has consolidation selection', () => {
    expect(hasAxisElementFilter(
      ['RowDim1'],
      ['ColDim1'],
      { RowDim1: { kind: 'consolidation' } },
    )).toBe(true);
  });

  it('returns false when selection exists for a dim NOT in row/col dims', () => {
    expect(hasAxisElementFilter(
      ['RowDim1'],
      ['ColDim1'],
      { TitleDim: { kind: 'elements', names: ['X'] } },
    )).toBe(false);
  });

  // "All" carries no names, but it is a statement about the axis: without this
  // `true`, `doRefresh` would only rewrite the slicer for an MDX view and the
  // axis would stay that of the saved view (click test 2026-08-12).
  it('returns true for an explicit whole-dimension selection', () => {
    expect(hasAxisElementFilter(
      ['RowDim1'],
      ['ColDim1'],
      { RowDim1: { kind: 'all' } },
    )).toBe(true);
  });

  it('returns false when there are no selections at all', () => {
    expect(hasAxisElementFilter(
      ['RowDim1'],
      ['ColDim1'],
      {},
    )).toBe(false);
  });
});
