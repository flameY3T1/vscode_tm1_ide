/**
 * An axis selection of the kind `expression` is inserted into the axis UNCHANGED
 * — it cannot be expressed as a name list, that is its purpose.
 *
 * Occasion (flameY3T1, 2026-08-20): the collapse state of an MDX view stands as a
 * DRILL*MEMBER chain on the axis. When it came back from the Dimension
 * Browser as a name list, it could no longer be told apart from a hand selection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// `state.ts` reads `window` at module level (number format) — must stand BEFORE the import.
vi.hoisted(() => { (globalThis as Record<string, unknown>).window = {}; });

vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: () => ({ chkSuppRows: {}, chkSuppCols: {} }),
  isToggleOn: () => false,
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { buildCurrentMdx } from '../webviewClient/cubeViewerMonaco/mdxBuild';
import { hasAxisElementFilter } from '../webviewClient/cubeViewerMonaco/mdxAxisFilterPure';

const DRILLED = '{DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[EBIT]})}';

describe('axis selection as an expression', () => {
  beforeEach(() => {
    state.cubeName = 'C';
    state.rowDims = ['Konten'];
    state.colDims = ['Jahre'];
    state.titleDims = [];
    state.titleAssignments = {};
    state.dimSelections = {};
    state.lastMatrix = {
      rowDims: ['Konten'], colDims: ['Jahre'],
      rowTuples: [['EBIT']], colTuples: [['2025']],
      rowElements: ['EBIT'], colElements: ['2025'],
    } as never;
  });

  it('inserts the expression literally into the row axis', () => {
    state.dimSelections.Konten = { kind: 'expression', expression: DRILLED };
    expect(buildCurrentMdx()).toContain(DRILLED);
  });

  it('displaces the tuples of the loaded matrix in doing so', () => {
    // Without a selection the builder builds the axis from the tuples (the exact set
    // of the view). An expression is the stronger statement and must win —
    // otherwise the MDX window would keep showing the old axis.
    expect(buildCurrentMdx()).toContain('[Konten].[EBIT]');
    state.dimSelections.Konten = { kind: 'expression', expression: DRILLED };
    const mdx = buildCurrentMdx();
    expect(mdx).toContain(DRILLED);
    expect(mdx).not.toMatch(/\{ \[Konten\]\.\[Konten\]\.\[EBIT\] \}/);
  });

  it('counts as an active axis filter', () => {
    // Otherwise the refresh would only rewrite the slicer and leave the axis of the
    // saved view standing.
    expect(hasAxisElementFilter(['Konten'], ['Jahre'], { Konten: { kind: 'expression', expression: DRILLED } })).toBe(true);
    expect(hasAxisElementFilter(['Konten'], ['Jahre'], { Konten: { kind: 'expression', expression: '' } })).toBe(false);
  });

  it('leaves the other selection kinds unchanged', () => {
    state.dimSelections.Konten = { kind: 'elements', names: ['A', 'B'] };
    expect(buildCurrentMdx()).toContain('[Konten].[Konten].[A]');
    state.dimSelections.Konten = { kind: 'all' };
    expect(buildCurrentMdx()).toContain('TM1SUBSETALL([Konten].[Konten])');
    state.dimSelections.Konten = { kind: 'consolidation', name: 'EBIT' };
    expect(buildCurrentMdx()).toContain('[Konten].[Konten].[EBIT]');
  });
});
