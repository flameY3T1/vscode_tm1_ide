import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {};
});
vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import { state } from '../webviewClient/dimensionBrowser/state';
import {
  startView, setMdxBase, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';
import { mdxDeviates } from '../webviewClient/dimensionBrowser/viewQuery';

let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };

/**
 * The only real loss compared to the old path (inventory 2026-08-23): there
 * the MDX bar says that the expression deviates from the SERVER STATE of the
 * loaded subset — you can see that you have changed it, and the tooltip
 * carries the original.
 */
describe('deviation from the stored subset', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    state._subsetSourceExpression = null; state._subsetExpressionUnread = false;
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    startView('aa', 'aa', post);
  });

  it('without a loaded subset there is nothing to deviate from', () => {
    applyFilter({ kind: 'type', types: ['C'] });
    expect(mdxDeviates()).toBeNull();
  });

  it('the freshly loaded subset does NOT deviate', () => {
    state._subsetSourceExpression = '{TM1SUBSETALL([aa].[aa])}'; state._subsetExpressionUnread = false;
    setMdxBase('{TM1SUBSETALL([aa].[aa])}');
    expect(mdxDeviates()).toBeNull();
  });

  it('a layer on top IS a deviation, and the original is named', () => {
    state._subsetSourceExpression = '{TM1SUBSETALL([aa].[aa])}'; state._subsetExpressionUnread = false;
    setMdxBase('{TM1SUBSETALL([aa].[aa])}');
    applyFilter({ kind: 'type', types: ['C'] });
    expect(mdxDeviates()).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

  it('whitespace alone is not a deviation', () => {
    state._subsetSourceExpression = '  {TM1SUBSETALL([aa].[aa])}  '; state._subsetExpressionUnread = false;
    setMdxBase('{TM1SUBSETALL([aa].[aa])}');
    expect(mdxDeviates()).toBeNull();
  });

  it('a STATIC subset has no expression — so no deviation', () => {
    // Otherwise the marker would claim a change to a rule that never existed.
    state._subsetSourceExpression = null; state._subsetExpressionUnread = false;
    applyFilter({ kind: 'type', types: ['C'] });
    expect(mdxDeviates()).toBeNull();
  });

  it('an UNREAD expression likewise — it is unknown, not empty', () => {

    state._subsetSourceExpression = null; state._subsetExpressionUnread = true;
    applyFilter({ kind: 'type', types: ['C'] });
    expect(mdxDeviates()).toBeNull();
  });
});
