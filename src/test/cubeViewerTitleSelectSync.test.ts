/**
 * The context selection in the cube viewer jumped back (flameY3T1, 2026-08-18).
 *
 * `state.titleAssignments` was read back from the DOM exclusively in `doRefresh`.
 * The `change` handler on the title select fields called `doRefresh`
 * only with auto-refresh switched on, though — if it was off, the state never knew the
 * freshly chosen context selection. The next `rebuildZones()` (for instance the
 * `dimSelectionUpdate` answer that the Dimension Browser sends) then repainted the
 * select field from the OLD `titleAssignments` and the selection was gone.
 *
 * The test drives the real `wireButtons()` and the real `change` handler; only
 * the DOM and neighbouring modules are dummies (no jsdom in this project).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, any>;
  g.__docListeners = {} as Record<string, Array<(e: unknown) => void>>;
  g.window = { addEventListener: () => {} };
  g.document = {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      (g.__docListeners[type] ??= []).push(handler);
    },
    getElementById: () => null,
    querySelectorAll: () => [],
  };
});

/** Any property access yields a stub element that swallows every DOM call. */
function refsProxy(): any {
  const el = () => ({
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    dataset: {},
  });
  return new Proxy({}, { get: () => el() });
}

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({ vscode: { postMessage: vi.fn() } }));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: () => refsProxy(), showLoading: vi.fn(), showError: vi.fn(), showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(), setToggleOn: vi.fn(), isToggleOn: vi.fn(() => false),
}));
vi.mock('../webviewClient/cubeViewerMonaco/pureBridge', () => ({
  undoStack: { push: vi.fn(), pop: vi.fn(), isEmpty: vi.fn(() => true), clear: vi.fn(), size: vi.fn(() => 0), peek: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/axis', () => ({
  rebuildZones: vi.fn(), fillSelect: vi.fn(), currentDimSubsetsAll: vi.fn(() => ({})),
  clearElementFetchPending: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({ syncTitleCombo: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({ renderGrid: vi.fn(), applyNumberFormat: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/viewPicker', () => ({
  populateViewSelect: vi.fn(), resetViewsLoaded: vi.fn(), showOpenedView: vi.fn(), ensureViewsFetched: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/viewSave', () => ({
  handleViewSaveResult: vi.fn(), refreshViewSaveVisibility: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/csv', () => ({ buildCsv: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/selection', () => ({ clearSelection: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/contextMenu', () => ({
  applyPendingDrillAction: vi.fn(), refreshAliasSubmenu: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/pageMerge', () => ({
  mergeRowPage: vi.fn(), nextLoadedRowMax: vi.fn(), CELL_PAGE_ROWS_CLIENT: 300,
}));
vi.mock('../webviewClient/cubeViewerMonaco/parentMergePure', () => ({ mergeParentDelta: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxView', () => ({ openMdxModal: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxBuild', () => ({ buildCurrentMdx: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/gridPure', () => ({ axisBaseNamesFromMatrix: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxSlicerPure', () => ({ rewriteMdxSlicer: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxPivotPure', () => ({ buildPivotedMdx: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/pivotPure', () => ({ consumePendingRefresh: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/refreshBridge', () => ({ setRefreshFn: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxAxisFilterPure', () => ({ hasAxisElementFilter: vi.fn() }));
vi.mock('../mdx/nonEmptyAxisPure', () => ({ setNonEmptyAxis: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/reqGuard', () => ({
  nextReqId: vi.fn(() => 1), isCurrentResponse: vi.fn(() => true),
}));

import { wireButtons } from '../webviewClient/cubeViewerMonaco/messaging';
import { state } from '../webviewClient/cubeViewerMonaco/state';

/** A `<select class="title-dim-select">` as the change handler sees it. */
function titleSelect(dim: string, value: string): any {
  return { classList: { contains: (c: string) => c === 'title-dim-select' }, dataset: { dim }, value };
}

function fireChange(target: unknown): void {
  const listeners = (globalThis as unknown as { __docListeners: Record<string, Array<(e: unknown) => void>> })
    .__docListeners.change ?? [];
  listeners.forEach((h) => h({ target }));
}

describe('cube viewer — title selection lands in the state immediately', () => {
  beforeEach(() => {
    (globalThis as unknown as { __docListeners: Record<string, unknown[]> }).__docListeners = {};
    state.titleAssignments = { Jahr: '2025' };
    state.titleOverride = false;
    state.autoRefresh = false;
    wireButtons();
  });

  it('writes the new selection into the state even with auto-refresh switched off', () => {
    fireChange(titleSelect('Jahr', '2026'));

    // Exactly that was missing: without this line, a later `rebuildZones()` would have
    // set the select field back to '2025'.
    expect(state.titleAssignments.Jahr).toBe('2026');
    expect(state.titleOverride).toBe(true);
  });

  it('leaves other title dims untouched', () => {
    state.titleAssignments = { Jahr: '2025', Version: 'Ist' };
    fireChange(titleSelect('Jahr', '2026'));

    expect(state.titleAssignments).toEqual({ Jahr: '2026', Version: 'Ist' });
  });

  it('ignores changes on foreign select fields', () => {
    fireChange({ classList: { contains: () => false }, dataset: { dim: 'Jahr' }, value: '2026' });

    expect(state.titleAssignments.Jahr).toBe('2025');
    expect(state.titleOverride).toBe(false);
  });

  it('does not overwrite an existing entry with an empty value', () => {
    fireChange(titleSelect('Jahr', ''));

    expect(state.titleAssignments.Jahr).toBe('2025');
  });
});
