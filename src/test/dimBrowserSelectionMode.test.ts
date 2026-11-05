import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, onViewRows, onViewCount, _resetViewPathForTest,
  currentMdx,
} from '../webviewClient/dimensionBrowser/viewPath';
import { toggleMark, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';
import {
  selectionFromView, selectionCountFromView,
} from '../webviewClient/dimensionBrowser/selectionSource';
import { state } from '../webviewClient/dimensionBrowser/state';
import { flashBanner } from '../webviewClient/dimensionBrowser/banner';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };

const zeile = (name: string, type: 'N' | 'C' | 'S' = 'N') => ({
  name, caption: name, type, level: 0, parent: null, ancestors: [], drilled: false,
});

function antworte(rows: ReturnType<typeof zeile>[], hasMore = false): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
    ok: true, rows, cardinality: rows.length, hasMore,
  } as never);
}

/**
 * Fresh state before every test.
 *
 * `state._acceptsExpression` and `state._allowedTypes` are MODULE-GLOBAL and
 * outlive the test that sets them. Until now only the first
 * `describe` block cleaned them up; under `--sequence.shuffle` (seed 777) "The
 * caller's preselection" inherited a `true` and got an expression instead of the
 * name list. That is why every block cleans up through the same function.
 */
function frischerStand(): void {
  posted = [];
  _resetViewPathForTest();
  _resetMarksForTest();
  state._allowedTypes = null;
  state._acceptsExpression = false;
  (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
}

/**
 * The Cube Viewer opens the browser as a SELECTION (filter chip of an axis).
 * The new path kept nothing for that: the footer counted
 * `state._visibleNames`, and "Apply" sent `_collectVisibleSelection()`
 * — both from the old state. The window opened, showed rows and returned
 * nothing on confirmation.
 */
describe('Selection mode in the new path', () => {
  beforeEach(() => {
    frischerStand();
    vi.mocked(flashBanner).mockClear();
  });

  it('a MARK is a manual selection — names, even if expressions would work', () => {
    state._acceptsExpression = true;
    startView('aa', 'aa', post);
    antworte([zeile('a'), zeile('b'), zeile('c')]);
    toggleMark('b');
    expect(selectionFromView()).toEqual({ kind: 'elements', names: ['b'] });
  });

  it('the untouched view is the WHOLE dimension', () => {
    // `{kind:'all'}` instead of a name list: the receiver puts the
    // whole dimension on the axis from it, instead of 5000 loaded names.
    startView('aa', 'aa', post);
    antworte([zeile('a')], true);
    expect(selectionFromView()).toEqual({ kind: 'all' });
  });

  it('with layers and a receiver that accepts expressions: the EXPRESSION', () => {
    state._acceptsExpression = true;
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    antworte([zeile('sum', 'C')]);
    expect(selectionFromView()).toEqual({ kind: 'expression', expression: currentMdx() });
  });

  it('without expression support, the visible names', () => {
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    antworte([zeile('sum', 'C'), zeile('d', 'C')]);
    expect(selectionFromView()).toEqual({ kind: 'elements', names: ['sum', 'd'] });
  });

  it('respects `allowedTypes`', () => {
    state._allowedTypes = ['N'];
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C', 'N'] });
    antworte([zeile('sum', 'C'), zeile('a', 'N')]);
    expect(selectionFromView()).toEqual({ kind: 'elements', names: ['a'] });
  });

  it('an incomplete window without an expression is REFUSED, not truncated', () => {
    // Otherwise the Cube Viewer would put 5000 of 1.6 million elements on the axis and
    // nobody would see that something is missing — the same danger as with a static
    // save.
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    antworte([zeile('sum', 'C')], true);
    expect(selectionFromView()).toBeNull();
    expect(vi.mocked(flashBanner)).toHaveBeenCalled();
  });

});

describe('The footer counts the view', () => {
  beforeEach(() => {
    frischerStand();
  });

  it('states the visible rows and the total count of the view', () => {
    startView('aa', 'aa', post);
    antworte([zeile('a'), zeile('b')]);
    const zid = (posted.filter((p) => p.type === 'fetchViewCount').at(-1) as { requestId: number }).requestId;
    onViewCount({
      type: 'viewCount', requestId: zid, dimName: 'aa', hierName: 'aa', ok: true, total: 7,
    } as never);
    expect(selectionCountFromView()).toEqual({ visible: 2, total: 7 });
  });

  it('without a counted total it reports -1 instead of claiming the loaded ones', () => {
    startView('aa', 'aa', post);
    antworte([zeile('a')]);
    expect(selectionCountFromView()).toEqual({ visible: 1, total: -1 });
  });

});

// ---------------------------------------------------------------------------

describe('The caller\'s preselection', () => {
  beforeEach(() => {
    frischerStand();
  });

  it('narrows the view to the given names, in their order', () => {
    // "The visible rows ARE the selection" (spec E3). An axis can be in
    // any order (MDX view), and confirming without
    // touching it must not rewrite it into tree order.
    startView('aa', 'aa', post, ['d', 'a']);
    expect(currentMdx()).toBe('{[aa].[aa].[d],[aa].[aa].[a]}');
    // And it fetches only ONCE — not first the tree and then the selection.
    expect(posted.filter((p) => p.type === 'fetchViewRows')).toHaveLength(1);
  });

  it('an empty preselection leaves the starting base in place', () => {
    startView('aa', 'aa', post, []);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });

  it('preselected like this, the view is NO longer "the whole dimension"', () => {
    // Otherwise "Apply" would answer with `{kind:'all'}` and put the whole
    // dimension on the axis, even though two rows are shown.
    startView('aa', 'aa', post, ['d', 'a']);
    antworte([zeile('d'), zeile('a')]);
    expect(selectionFromView()).toEqual({ kind: 'elements', names: ['d', 'a'] });
  });
});

// ---------------------------------------------------------------------------

describe('The caller\'s axis expression beats the name list', () => {
  beforeEach(() => {
    frischerStand();
  });

  it('becomes the base — the names next to it are only the shadow of the axis', () => {
    // The Cube Viewer sends both: its drawn rows as names AND
    // the axis expression. Only the expression carries the COLLAPSE STATE — a
    // collapsed consolidation appears there as `DRILLUPMEMBER`, while the
    // name list shows no trace of it. Whoever takes the names comes back with an
    // expanded row (click test 2026-08-23).
    //
    // The old path does the same and says so in `consumePendingSourceMdx`:
    // "Where an expression exists, IT is the statement."
    startView('aa', 'aa', post, ['d', 'a'], '{DRILLUPMEMBER({[aa].[aa].Members}, {[aa].[aa].[d]})}');
    expect(currentMdx()).toBe('{DRILLUPMEMBER({[aa].[aa].Members}, {[aa].[aa].[d]})}');
    expect(posted.filter((p) => p.type === 'fetchViewRows')).toHaveLength(1);
  });

  it('without an expression it stays with the names', () => {
    startView('aa', 'aa', post, ['d', 'a'], '');
    expect(currentMdx()).toBe('{[aa].[aa].[d],[aa].[aa].[a]}');
  });
});
