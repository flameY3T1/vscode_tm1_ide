import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
    vwBaseMdx: 'MDX', vwBaseMembers: 'Tree',
  };
});
vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import { initialView, mdxBase, orderIsReplaced } from '../webviewClient/dimensionBrowser/intents';
import { storedMdx, fetchMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { trailHtml } from '../webviewClient/dimensionBrowser/viewTrail';
import {
  startView, setMdxBase, currentMdx, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

/**
 * A hand-written expression is a BASE, not a layer.
 *
 * With that, "Run" in the MDX popup has a meaning again in the new path, without
 * opening a second state next to the stack: the expression replaces the
 * answer, on top of which layers are then placed as usual. Before, the
 * button wrote into `state._subsetExpression` and let the OLD renderer draw over the
 * new one.
 */
describe('Hand-written MDX as a base', () => {
  it('takes the expression literally', () => {
    const v = mdxBase('{TM1SUBSETALL([aa].[aa])}');
    expect(storedMdx(v, 'aa', 'aa')).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

  it('clears the stack — a new base is a new answer', () => {
    expect(mdxBase('{x}').intents).toEqual([]);
  });

  it('the window still wraps around it', () => {
    expect(fetchMdx(mdxBase('{x}'), 'aa', 'aa', 0, 10)).toBe('{SUBSET({x}, 0, 11)}');
  });

  it('counts as reordered — we know nothing about a foreign order', () => {
    // `orderIsReplaced` decides whether rows are indented. For an expression
    // that the user wrote, the tree order is not guaranteed —
    // indenting would mean claiming an order that nobody has checked.
    expect(orderIsReplaced(mdxBase('{x}'))).toBe(true);
    expect(orderIsReplaced(initialView('tree'))).toBe(false);
  });

  it('the trail calls it MDX', () => {
    expect(trailHtml(mdxBase('{x}'))).toContain('MDX');
  });
});

describe('Run on the new load path', () => {
  let posted: { type: string; mdx?: string }[] = [];
  const post = (m: unknown) => { posted.push(m as never); };
  const zeilen = () => posted.filter((p) => p.type === 'fetchViewRows');

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('fetches with the given expression', () => {
    startView('aa', 'aa', post);
    setMdxBase('{TM1SUBSETALL([aa].[aa])}');
    expect(zeilen().at(-1)!.mdx).toContain('TM1SUBSETALL([aa].[aa])');
    expect(currentMdx()).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

  it('an empty expression is not a base', () => {
    startView('aa', 'aa', post);
    const n = zeilen().length;
    setMdxBase('   ');
    expect(zeilen()).toHaveLength(n);
  });

  it('the same expression TWICE resets — it is the way back to the start', () => {
    // The same decision as for `setBase` (flameY3T1, 2026-08-22: "when I
    // click tree or all, everything should always be reset").
    //
    // It is not a matter of taste here: "Refresh" behind the selection field reloads
    // the subset, and its base is the same expression as before — the
    // filters only sit on top of it. A guard "the same expression does not fetch
    // twice" left the button ineffective (click test 2026-08-23).
    startView('aa', 'aa', post);
    setMdxBase('{x}');
    applyFilter({ kind: 'type', types: ['C'] });
    expect(currentMdx()).toContain('ELEMENT_TYPE');
    const n = zeilen().length;
    setMdxBase('{x}');
    expect(zeilen()).toHaveLength(n + 1);
    expect(currentMdx()).toBe('{x}');
  });
});
