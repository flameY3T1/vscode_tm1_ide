/**
 * The path to the Dimension Browser must read the EFFECTIVE expression.
 *
 * `currentDimExpressionInfo` (axis.ts) — the source of the `currentExpression`
 * that the filter chip sends to the Dimension Browser — read
 * `state.lastInlineMdx || state.originalMdx` directly. Both are the
 * BASE, not the effective one: the shortcuts that save a server round trip
 * ("Keep only", collapsing what is already loaded) are not in it. The
 * browser therefore opened with the state BEFORE the last narrowing
 * (click test 2026-08-23).
 *
 * A separate crack, independent of how the collapse state is written out
 * — it also affects the shortcuts that already existed before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { window?: unknown }).window ??= {};
  (globalThis as unknown as { document?: unknown }).document = {
    createElement: () => ({
      className: '', textContent: '', title: '', dataset: {},
      classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
      appendChild: (c: unknown) => c,
      addEventListener: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
    }),
    getElementById: () => null,
  };
  (globalThis as unknown as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(() => ({
    zoneRows: { appendChild: vi.fn(), querySelectorAll: vi.fn(() => []) },
    zoneCols: { appendChild: vi.fn(), querySelectorAll: vi.fn(() => []) },
    zoneTitles: { appendChild: vi.fn(), querySelectorAll: vi.fn(() => []) },
    gridContainer: { querySelectorAll: vi.fn(() => []) },
    chkSuppRows: {}, chkSuppCols: {},
  })),
  isToggleOn: vi.fn(() => false),
  showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({
  attachTitleCombo: vi.fn((sel: unknown) => sel),
  closeTitleCombo: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({ renderGrid: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/refreshBridge', () => ({
  requestRefresh: vi.fn(), setRefreshFn: vi.fn(),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { setInlineMdx } from '../webviewClient/cubeViewerMonaco/mdxBuild';
import { _expressionFields } from '../webviewClient/cubeViewerMonaco/axis';

const BASE = 'SELECT NON EMPTY {[Jahre].[Jahre].[2025]} ON COLUMNS ,'
  + ' NON EMPTY {DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})} ON ROWS'
  + ' FROM [C]';

describe('filter chip → Dimension Browser', () => {
  beforeEach(() => {
    state.isMdxView = true;
    state.originalMdx = BASE;
    state.collapsed = {};
    state.dimSelections = {};
    state.lastMatrix = null;
    setInlineMdx(BASE);
  });

  it('passes on the factor of the dimension', () => {
    expect(_expressionFields('Konten').currentExpression)
      .toBe('{DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})}');
  });

  it('passes the collapse state along — the browser sees what the grid shows', () => {
    state.collapsed = { Konten: { 'Ergebnis (EBIT)': true } };
    expect(_expressionFields('Konten').currentExpression).toBe(
      '{EXCEPT({DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})},'
      + ' EXCEPT(DESCENDANTS([Konten].[Konten].[Ergebnis (EBIT)]),'
      + ' {[Konten].[Konten].[Ergebnis (EBIT)]}, ALL), ALL)}',
    );
  });

  it('without an MDX view it stays on the previous path', () => {
    state.isMdxView = false;
    // No MDX view: `effectiveInlineMdx` returns `null`, the base is
    // read — otherwise the chip would no longer find any factor at all.
    expect(_expressionFields('Konten').currentExpression)
      .toBe('{DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})}');
  });

  it('names the reason when nothing comes out', () => {
    const f = _expressionFields('Gibtsnicht');
    expect(f.currentExpression).toBeUndefined();
    expect(f.currentExpressionNote).toContain('Gibtsnicht');
  });
});
