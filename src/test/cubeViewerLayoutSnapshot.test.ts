import { describe, it, expect } from 'vitest';
import type { CubeViewerState } from '../webviewClient/cubeViewerMonaco/state';
import { snapshotLayout, storedLayout, applyLayout } from '../webviewClient/cubeViewerMonaco/layoutSnapshot';

// "Move into New Window" reloads the webview and the host resends the FIRST
// open's initData. The layout on screen has to come back from the webview
// state — an alternate hierarchy pivoted to the titles fell back to the rows.
// A plain object stands in for the live state: `state.ts` needs a window.
const state = {} as CubeViewerState;

describe('cube viewer layout snapshot (panel moved to a new window)', () => {
  it('brings back an alternate hierarchy that was moved to the titles', () => {
    state.cubeName = 'C';
    state.rowDims = ['D'];
    state.colDims = ['M'];
    state.titleDims = ['D:Alt'];
    state.titleAssignments = { 'D:Alt': 'x' };
    const snap = snapshotLayout(state, true, false, {});

    state.rowDims = ['D', 'D:Alt'];
    state.titleDims = [];
    state.titleAssignments = {};
    const back = storedLayout({ cubeLayout: snap }, 'C');
    expect(back).not.toBeNull();
    applyLayout(state, back!);

    expect(state.rowDims).toEqual(['D']);
    expect(state.titleDims).toEqual(['D:Alt']);
    expect(state.titleAssignments).toEqual({ 'D:Alt': 'x' });
    expect(back!.suppressRows).toBe(true);
  });

  it('is a copy — later edits of the live state do not leak into it', () => {
    state.cubeName = 'C';
    state.titleAssignments = { a: '1' };
    const snap = snapshotLayout(state, false, false, {});
    state.titleAssignments.a = '2';
    expect(snap.fields.titleAssignments).toEqual({ a: '1' });
  });

  // Review 2026-11-02, C3: without a loaded matrix the axis members cannot be
  // derived, and the restore asked the server for whole dimensions.
  it('keeps the axis members, the local focus and the number format for the restore', () => {
    state.cubeName = 'C';
    state.localFocus = { dim: 'D', visible: new Set(['a', 'b']) };
    state.numFmt = { comma: true, decimals: 3, reformat: true };
    const snap = snapshotLayout(state, false, false, { D: ['a', 'b', 'c'] });

    const target = { ...state, localFocus: null, restoredDimSubsets: {} } as CubeViewerState;
    applyLayout(target, storedLayout({ cubeLayout: snap }, 'C')!);

    expect(target.restoredDimSubsets).toEqual({ D: ['a', 'b', 'c'] });
    expect(target.localFocus?.dim).toBe('D');
    expect([...target.localFocus!.visible]).toEqual(['a', 'b']);
    expect(target.numFmt).toEqual({ comma: true, decimals: 3, reformat: true });
  });

  it('ignores a layout of another cube and an empty state', () => {
    state.cubeName = 'C';
    const snap = snapshotLayout(state, false, false, {});
    expect(storedLayout({ cubeLayout: snap }, 'Other')).toBeNull();
    expect(storedLayout(undefined, 'C')).toBeNull();
  });
});
