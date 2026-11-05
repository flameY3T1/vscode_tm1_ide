/**
 * `buildCurrentMdx` must carry `state.dimAliases` into a `DIMENSION PROPERTIES`
 * clause — the only place an MDX view can store the display alias (see
 * `src/mdx/dimensionPropertiesPure.ts`).
 *
 * Occasion (2026-08-24): a Native→MDX type change lost the alias. The save
 * dialog (`viewSave.ts`, path 3) calls `buildCurrentMdx()` when a native
 * view is deliberately stored as MDX — until then the builder did not know
 * `state.dimAliases`; `syncAliasIntoMdx` only applies to an already loaded
 * MDX view (gated by `isMdxView`).
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
import { detectDimensionProperties } from '../mdx/dimensionPropertiesPure';

describe('buildCurrentMdx carries dimAliases', () => {
  beforeEach(() => {
    state.cubeName = 'C';
    state.rowDims = ['Konten'];
    state.colDims = ['Jahre'];
    state.titleDims = [];
    state.titleAssignments = {};
    state.dimSelections = {};
    state.dimAliases = {};
    state.lastMatrix = {
      rowDims: ['Konten'], colDims: ['Jahre'],
      rowTuples: [['EBIT']], colTuples: [['2025']],
      rowElements: ['EBIT'], colElements: ['2025'],
    } as never;
  });

  it('writes the alias of a row dimension as DIMENSION PROPERTIES on ROWS', () => {
    state.dimAliases = { Konten: 'ALIAS_TEXT' };
    const mdx = buildCurrentMdx();
    expect(detectDimensionProperties(mdx)).toEqual({ Konten: 'ALIAS_TEXT' });
    expect(mdx).toMatch(/DIMENSION PROPERTIES \[Konten\]\.\[Konten\]\.\[ALIAS_TEXT\][^\n]*ON ROWS/);
  });

  it('writes the alias of a column dimension as DIMENSION PROPERTIES on COLUMNS', () => {
    state.dimAliases = { Jahre: 'ALIAS_TEXT' };
    const mdx = buildCurrentMdx();
    expect(detectDimensionProperties(mdx)).toEqual({ Jahre: 'ALIAS_TEXT' });
    expect(mdx).toMatch(/DIMENSION PROPERTIES \[Jahre\]\.\[Jahre\]\.\[ALIAS_TEXT\][^\n]*ON COLUMNS/);
  });

  it('writes both axes when both carry an alias', () => {
    state.dimAliases = { Konten: 'A1', Jahre: 'A2' };
    const mdx = buildCurrentMdx();
    expect(detectDimensionProperties(mdx)).toEqual({ Konten: 'A1', Jahre: 'A2' });
  });

  it('stays without a clause when no alias is set', () => {
    const mdx = buildCurrentMdx();
    expect(mdx).not.toContain('DIMENSION PROPERTIES');
  });

  it('ignores aliases for dimensions that stand on no axis (title dim)', () => {
    state.dimAliases = { Datenarten: 'ALIAS_TEXT' };
    const mdx = buildCurrentMdx();
    expect(mdx).not.toContain('DIMENSION PROPERTIES');
  });
});
