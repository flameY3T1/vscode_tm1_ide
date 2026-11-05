import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, setAlias, currentMdx, dimOfView, hierOfView,
  switchHierarchy, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { state } from '../webviewClient/dimensionBrowser/state';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

let posted: { type: string; hierName?: string; dimName?: string }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
const typen = () => posted.map((p) => p.type);

/**
 * The hierarchy selection was rejected in the new path (plan 3 review): the old
 * handler posts `fetchElements` and thereby brought back the old renderer.
 * The new path needs a new VIEW instead.
 */
describe('Switching the hierarchy', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    startView('aa', 'aa', post);
  });

  it('starts from scratch on the new hierarchy', () => {
    applyFilter({ kind: 'type', types: ['C'] });
    posted = [];
    switchHierarchy('zweite');
    expect(hierOfView()).toBe('zweite');
    expect(dimOfView()).toBe('aa');
    // The layers belonged to the old hierarchy — a type filter may still
    // apply there, but a selection of names certainly does not.
    expect(currentMdx()).toBe('{[aa].[zweite].Members}');
  });

  it('fetches rows, count, attributes, levels and the subset list again', () => {
    posted = [];
    switchHierarchy('zweite');
    for (const t of ['fetchViewRows', 'fetchViewCount', 'fetchAttrDefs', 'fetchLevels', 'fetchSubsets']) {
      expect(typen(), t).toContain(t);
    }
    // And specifically for the NEW hierarchy.
    for (const p of posted) { if (p.hierName) { expect(p.hierName).toBe('zweite'); } }
  });

  it('NEVER `fetchElements` — that is the old renderer', () => {
    posted = [];
    switchHierarchy('zweite');
    expect(typen()).not.toContain('fetchElements');
  });

  it('the display alias is dropped — it belonged to the old hierarchy', () => {
    // An attribute of the same name in the new one would be a different alias, and a
    // missing one would leave every row under its name, while the field
    // claims something else.
    setAlias('SITENAME');
    posted = [];
    switchHierarchy('zweite');
    expect(posted.filter((p) => p.type === 'fetchViewRows')
      .every((p) => !(p as { alias?: string }).alias)).toBe(true);
  });

  it('the same hierarchy again does nothing', () => {
    posted = [];
    switchHierarchy('aa');
    expect(posted).toEqual([]);
  });

  it('an empty name does nothing', () => {
    posted = [];
    switchHierarchy('');
    expect(posted).toEqual([]);
  });

  // Review E1: header, save and subset reference read `_currentHier`. It must
  // follow the running view — and only a switch that actually happens.
  it('carries _currentHier along only on a real switch', () => {

    state._currentHier = 'aa';
    switchHierarchy('zweite');
    expect(state._currentHier).toBe('zweite');
    _resetViewPathForTest();
    switchHierarchy('dritte');
    expect(state._currentHier).toBe('zweite');
  });
});
