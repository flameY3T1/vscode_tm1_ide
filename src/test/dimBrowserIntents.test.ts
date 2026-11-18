import { describe, it, expect } from 'vitest';
import {
  initialView, toggleCollapse, isCollapsed, freezeOrder, toggleDrill, pushIntent,
} from '../webviewClient/dimensionBrowser/intents';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';

describe('re-expanding over a narrowed set shows ALL children', () => {
  // Click test 2026-11-13: keep one year, show its consolidation, collapse it,
  // expand it - only the kept year came back, not every child.
  const kept = pushIntent(initialView('tree'), { kind: 'keep', names: ['Total', '2024'] });

  it('drills on top of the collapse instead of taking it off', () => {
    const zu = toggleDrill(kept, 'Total', true);
    const auf = toggleDrill(zu, 'Total', false);
    expect(auf.intents.map((i) => i.kind)).toEqual(['keep', 'collapse', 'expand']);
    expect(storedMdx(auf, 'D', 'D')).toMatch(/^\{DRILLDOWNMEMBER\(\{DRILLUPMEMBER\(\{INTERSECT/);
  });

  it('collapsing again does not pile up layers', () => {
    const auf = toggleDrill(toggleDrill(kept, 'Total', true), 'Total', false);
    expect(toggleDrill(auf, 'Total', true).intents.map((i) => i.kind)).toEqual(['keep', 'collapse']);
  });

  it('without a narrowing layer the collapse is still just taken off', () => {
    const auf = toggleDrill(toggleDrill(initialView('tree'), 'Total', true), 'Total', false);
    expect(auf.intents).toEqual([]);
  });
});

describe('Intent model', () => {
  it('starts with the chosen base and without intents', () => {
    expect(initialView('tree')).toEqual({ base: { kind: 'tree' }, intents: [] });
  });

  it('collapsing appends an intent', () => {
    const v = toggleCollapse(initialView('tree'), 'd');
    expect(v.intents).toEqual([{ kind: 'collapse', member: 'd' }]);
    expect(isCollapsed(v, 'd')).toBe(true);
  });

  it('expanding REMOVES the intent again — no counterpart', () => {
    // `.Members` is the fully expanded tree; DRILLDOWNMEMBER on it is
    // pointless (measured live on 11.8, same result as the input).
    const zu = toggleCollapse(initialView('tree'), 'd');
    const auf = toggleCollapse(zu, 'd');
    expect(auf.intents).toEqual([]);
    expect(isCollapsed(auf, 'd')).toBe(false);
  });

  it('leaves the intents of other nodes alone', () => {
    let v = toggleCollapse(initialView('tree'), 'd');
    v = toggleCollapse(v, 'sum');
    v = toggleCollapse(v, 'd');
    expect(v.intents).toEqual([{ kind: 'collapse', member: 'sum' }]);
  });

  it('moving freezes the order and discards all intents', () => {
    // Measured: nested UNION/HEAD/SUBSET splices are unusable
    // (3 moves 4.5 s, 10 a timeout). An enumerated
    // set with 5000 members costs 134 ms.
    const v = freezeOrder(toggleCollapse(initialView('tree'), 'd'), ['b', 'a', 'c']);
    expect(v).toEqual({ base: { kind: 'explicit', names: ['b', 'a', 'c'] }, intents: [] });
  });

  it('does not change the passed state', () => {

    const vor = initialView('tree');
    toggleCollapse(vor, 'd');
    expect(vor.intents).toEqual([]);
  });
});
