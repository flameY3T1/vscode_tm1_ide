import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Bug report flameY3T1, 2026-08-20:
 *
 *   "I open an MDX view […], select only Ergebnis in Konten in the viewer and
 *    save as a view. But the MDX did not adapt, and the subset is saved exactly
 *    like that […] although only Ergebnis (EBIT) is selected and I
 *    see it in the view"
 *
 * Cause: two local shortcuts narrow the display without asking the
 * server — "Keep only" & co. (`contextMenu#_postDrillFilter`) and
 * collapsing what is already loaded (`grid.ts`, `localToggle`). Both save the
 * server round trip on purpose; exactly because of that, the trace this round otherwise
 * leaves was missing: `doRefresh` rewrites `lastInlineMdx`, the shortcuts do not.
 * The MDX window and "Save as view" therefore read the state BEFORE the
 * narrowing — and saved it.
 */

// `state.ts` reads `window` at module level (number format) — must stand BEFORE the import.
vi.hoisted(() => { (globalThis as Record<string, unknown>).window = {}; });

const refs = {
  chkSuppRows: { dataset: { on: '1' } },
  chkSuppCols: { dataset: { on: '1' } },
};

vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: () => refs,
  isToggleOn: (el: { dataset: { on?: string } }) => el?.dataset?.on === '1',
  getTitleAssignments: () => ({}),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import {
  effectiveInlineMdx,
  setInlineMdx,
  markInlineMdxStale,
  buildCurrentMdx,
} from '../webviewClient/cubeViewerMonaco/mdxBuild';

const ORIGINAL =
  'SELECT NON EMPTY {[Jahre].[Jahre].[2025]} ON COLUMNS, NON EMPTY '
  + '{DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Ergebnis (EBIT)]})} '
  + 'ON ROWS FROM [Top_Level_Cube]';

beforeEach(() => {
  state.cubeName = 'Top_Level_Cube';
  state.isMdxView = true;
  state.originalMdx = ORIGINAL;
  state.rowDims = ['Konten'];
  state.colDims = ['Jahre'];
  state.titleDims = [];
  state.titleAssignments = {};
  state.dimSelections = {};
  state.lastMatrix = {
    rowDims: ['Konten'],
    colDims: ['Jahre'],
    rowElements: ['Ergebnis (EBIT)', 'Summe Erträge', 'Primäraufwand'],
    colElements: ['2025'],
    rowTuples: [['Ergebnis (EBIT)'], ['Summe Erträge'], ['Primäraufwand']],
    colTuples: [['2025']],
    values: {},
  } as unknown as typeof state.lastMatrix;
  setInlineMdx(ORIGINAL);
});

describe('effectiveInlineMdx — the effective MDX follows the display', () => {
  it('without local narrowing returns exactly what ran last', () => {
    expect(effectiveInlineMdx()).toBe(ORIGINAL);
  });

  it('rebuilds after a local narrowing — and names only the shown row', () => {
    // Exactly the state that `_postDrillFilter` or `localToggle` leave behind:
    // selection set, grid redrawn, NO server round trip.
    state.dimSelections['Konten'] = { kind: 'elements', names: ['Ergebnis (EBIT)'] };
    markInlineMdxStale();

    const mdx = effectiveInlineMdx();
    expect(mdx).not.toBe(ORIGINAL);
    expect(mdx).toContain('[Konten].[Konten].[Ergebnis (EBIT)]');
    expect(mdx).not.toContain('Summe Erträge');
    expect(mdx).not.toContain('Primäraufwand');
  });

  it('builds exactly once — the second reader gets the same without a rebuild', () => {
    state.dimSelections['Konten'] = { kind: 'elements', names: ['Ergebnis (EBIT)'] };
    markInlineMdxStale();
    const first = effectiveInlineMdx();
    expect(state._inlineMdxStale).toBe(false);
    expect(effectiveInlineMdx()).toBe(first);
  });

  it('matches what a real refresh would have written', () => {
    // With an axis filter set, `doRefresh` takes `buildCurrentMdx()`. The
    // shortcut must leave the same trace, otherwise the result depends
    // on whether a server round trip happened by chance.
    state.dimSelections['Konten'] = { kind: 'elements', names: ['Ergebnis (EBIT)'] };
    const viaRefresh = buildCurrentMdx();
    markInlineMdxStale();
    expect(effectiveInlineMdx()).toBe(viaRefresh);
  });

  it('leaves the other axis dimensions untouched', () => {
    state.dimSelections['Konten'] = { kind: 'elements', names: ['Ergebnis (EBIT)'] };
    markInlineMdxStale();
    expect(effectiveInlineMdx()).toContain('[Jahre].[Jahre].[2025]');
  });

  it('`setInlineMdx` clears the marker — a real run is the truth', () => {
    markInlineMdxStale();
    expect(state._inlineMdxStale).toBe(true);
    setInlineMdx('SELECT {} ON 0, {} ON 1 FROM [c]');
    expect(state._inlineMdxStale).toBe(false);
    expect(effectiveInlineMdx()).toBe('SELECT {} ON 0, {} ON 1 FROM [c]');
  });

  it('stays silent for a native view — there is no inline MDX there', () => {
    state.isMdxView = false;
    expect(effectiveInlineMdx()).toBeNull();
    markInlineMdxStale();
    expect(state._inlineMdxStale).toBe(false);
  });

  it('falls back to the original MDX as long as nothing ran', () => {
    setInlineMdx(null);
    expect(effectiveInlineMdx()).toBe(ORIGINAL);
  });
});

/**
 * Source guard: `lastInlineMdx` has exactly ONE write path. Two writers with
 * only one marker reset would again be the silent half that produced this
 * bug — and a reader that reads the field directly would see the old state.
 */
describe('source guard: one write path, one read path', () => {
  const dir = join(__dirname, '..', 'webviewClient', 'cubeViewerMonaco');
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');

  it('only `mdxBuild.ts` writes `state.lastInlineMdx` directly', () => {
    const others = ['messaging.ts', 'axis.ts', 'contextMenu.ts', 'mdxView.ts', 'viewSave.ts', 'grid.ts', 'gridClick.ts'];
    for (const f of others) {
      expect(read(f), f).not.toMatch(/state\.lastInlineMdx\s*=/);
    }
  });

  it('saving reads via `effectiveInlineMdx`', () => {
    const src = read('viewSave.ts');
    expect(src).toContain('effectiveInlineMdx()');
    expect(src).not.toContain('state.lastInlineMdx');
  });

  it('the MDX window reads via `effectiveInlineMdx`', () => {
    const src = read('mdxView.ts');
    expect(src).toContain('effectiveInlineMdx()');
    expect(src).not.toContain('state.lastInlineMdx');
  });

  it('both local shortcuts set the marker', () => {
    expect(read('contextMenu.ts')).toContain('markInlineMdxStale()');
    expect(read('gridClick.ts')).toContain('markInlineMdxStale()');
  });
});
