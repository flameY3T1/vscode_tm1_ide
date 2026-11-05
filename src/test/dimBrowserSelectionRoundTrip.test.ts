import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, applyCtxAction, onViewRows, currentMdx, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { toggleMark, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';
import { selectionFromView } from '../webviewClient/dimensionBrowser/selectionSource';
import { state } from '../webviewClient/dimensionBrowser/state';
import { keepMarked } from '../webviewClient/dimensionBrowser/viewLayers';

let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
const zeile = (name: string) => ({
  name, caption: name, type: 'N' as const, level: 0, parent: null, ancestors: [], drilled: false,
});
function antworte(namen: string[]): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
    ok: true, rows: namen.map(zeile), cardinality: namen.length, hasMore: false,
  } as never);
}

/** The round trip the Cube Viewer makes: open, narrow down, confirm. */
describe('narrowing down and confirming', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetMarksForTest();
    state._allowedTypes = null;
    state._acceptsExpression = true;
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('"only this element" returns exactly that one', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c']);
    expect(applyCtxAction('only-this', 'b')).toBe(true);
    antworte(['b']);
    expect(currentMdx()).toBe('{[aa].[aa].[b]}');
    expect(selectionFromView()).toEqual({ kind: 'expression', expression: '{[aa].[aa].[b]}' });
  });

  it('"only this" means the MARKING, if there is one', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c']);
    toggleMark('a');
    toggleMark('c');
    applyCtxAction('only-this', 'b');
    antworte(['a', 'c']);
    expect(selectionFromView())
      .toEqual({ kind: 'expression', expression: '{[aa].[aa].[a],[aa].[aa].[c]}' });
  });

  it('marking two and "Keep" returns those two', () => {

    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c']);
    toggleMark('a');
    toggleMark('b');
    keepMarked();
    antworte(['a', 'b']);
    expect(selectionFromView())
      .toEqual({ kind: 'expression', expression: '{[aa].[aa].[a],[aa].[aa].[b]}' });
  });
});
