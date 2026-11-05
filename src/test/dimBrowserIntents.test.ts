import { describe, it, expect } from 'vitest';
import {
  initialView, toggleCollapse, isCollapsed, freezeOrder,
} from '../webviewClient/dimensionBrowser/intents';

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
