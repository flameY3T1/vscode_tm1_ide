import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => { (globalThis as Record<string, unknown>).window = {}; });

vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: () => ({ chkSuppRows: {}, chkSuppCols: {} }),
  isToggleOn: () => false,
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { effectiveInlineMdx, setInlineMdx } from '../webviewClient/cubeViewerMonaco/mdxBuild';

/**
 * The DISPLAY collapse state belongs in the effective expression — as a shell around
 * the existing one, not as a rebuild.
 *
 * A collapse on a view without a user selection only writes
 * `state.collapsed[dim][elem] = true` and redraws (`grid.ts`). So nobody
 * carried it: not the MDX window, not "Save as view", not the
 * Dimension Browser (click test 2026-08-23).
 *
 * The first attempt (`10196166`, reverted in `063fab53`) wrote it into
 * `buildCurrentMdx` — and that one REBUILDS the axis from the matrix tuples. The
 * reported damage: two expressions turned into a flat tuple list, the
 * second ValueFields line dropped out, and the names in it came from the
 * display (alias), not from the dimension.
 *
 * Now the collapse state is derived on READING: `lastInlineMdx` stays
 * what the server or editor wrote, and `effectiveInlineMdx`
 * lays the collapse shells over it (`EXCEPT`/`DESCENDANTS`, see
 * `mdxParts#collapseMemberSet`). Expanding therefore needs no
 * unwinding in the text — the entry drops away, and the shell simply no longer
 * comes into being on the next read.
 */
describe('collapsing stands in the effective MDX', () => {
  // The bug report itself, shortened: expressions on both axes.
  const BASE = [
    'SELECT NON EMPTY {[Jahre].[Jahre].[2025]}',
    ' * {TM1FILTERBYLEVEL([Datenarten].[Datenarten].MEMBERS , 0)} ON COLUMNS ,',
    ' NON EMPTY {DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})}',
    ' * {[ValueFields].[ValueFields].[Wert und Menge^Wert],[ValueFields].[ValueFields].[SuWertfelder^Menge]} ON ROWS',
    ' FROM [Top_Level_Cube] WHERE ([Stations].[Stations].[CC2026_A12_C])',
  ].join('');

  beforeEach(() => {
    state.isMdxView = true;
    state.originalMdx = BASE;
    state.collapsed = {};
    state.dimSelections = {};
    state.lastMatrix = null;
    setInlineMdx(BASE);
  });

  it('without collapsing the expression stays the same character for character', () => {
    expect(effectiveInlineMdx()).toBe(BASE);
  });

  it('a collapsed node appears as a shell around the previous factor', () => {
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    expect(effectiveInlineMdx()).toContain(
      '{EXCEPT({DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})},'
      + ' EXCEPT(DESCENDANTS([Konten].[Konten].[Ergebnis (EBIT)]),'
      + ' {[Konten].[Konten].[Ergebnis (EBIT)]}, ALL), ALL)}',
    );
  });

  it('does NOT say it as DRILLUPMEMBER — that has no effect on a foreign list', () => {
    // Measured live (11.8, `Reporting/Default`, 2026-08-23): DRILLUPMEMBER on
    // the `EXCEPT` list of a saved MDX view leaves the count at
    // 14 — a silent no-op. The rows stayed in the Dimension Browser,
    // while the grid hid them (click test flameY3T1).
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    expect(effectiveInlineMdx()).not.toContain('DRILLUPMEMBER');
  });

  it('the remaining axes stay untouched', () => {
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    const mdx = effectiveInlineMdx() as string;
    // Exactly the damage from the report: column expression mangled, second
    // ValueFields line gone.
    expect(mdx).toContain('{TM1FILTERBYLEVEL([Datenarten].[Datenarten].MEMBERS , 0)} ON COLUMNS');
    expect(mdx).toContain('[ValueFields].[ValueFields].[SuWertfelder^Menge]');
    expect(mdx).toContain('FROM [Top_Level_Cube] WHERE ([Stations].[Stations].[CC2026_A12_C])');
  });

  it('several nodes nest', () => {
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true, 'Umsätze': true } };
    const mdx = effectiveInlineMdx() as string;
    // Per node one outer EXCEPT plus the inner "without itself".
    expect(mdx.match(/EXCEPT\(/g)?.length).toBe(4);
    expect(mdx.match(/DESCENDANTS\(/g)?.length).toBe(2);
  });

  it('expanding falls back without unwinding the text', () => {
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    expect(effectiveInlineMdx()).not.toBe(BASE);
    delete state.collapsed['Konten']['Ergebnis (EBIT)'];
    expect(effectiveInlineMdx()).toBe(BASE);
  });

  it('the base stays collapse-free — no build-up on the second read', () => {
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    const once = effectiveInlineMdx();
    expect(effectiveInlineMdx()).toBe(once);
    expect(state.lastInlineMdx).toBe(BASE);
  });

  it('a dimension without an unambiguous factor leaves the expression standing', () => {
    // Only in the WHERE — there is no collapse state to express there.
    state.collapsed = { Stations: { CC2026_A12_C: true } };
    expect(effectiveInlineMdx()).toBe(BASE);
  });

  it('no MDX view, no derivation', () => {
    state.isMdxView = false;
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    expect(effectiveInlineMdx()).toBeNull();
  });
});
