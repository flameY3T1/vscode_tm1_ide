import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
    vwTrailLevel: 'Level {0}', vwBaseMembers: 'Tree',
  };
});

import { matchesLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import type { FilterLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { layerLabel } from '../webviewClient/dimensionBrowser/viewTrail';
import { initialView, pushIntent, setLevelFilter, currentLevels } from '../webviewClient/dimensionBrowser/intents';

const mit = (layer: FilterLayer) => pushIntent(initialView('tree'), { kind: 'filter', layer });
const S = '{[aa].[aa].Members}';

/**
 * Measured live on `aa` (2026-08-23), tree order `sum a d c a x b xxx x xx`:
 *
 *   TM1FILTERBYLEVEL 0            a c a x b x        (6)
 *   TM1FILTERBYLEVEL 1            sum d xx           (3)
 *   UNION(E0, E1, ALL)            a c a x b x sum d xx   -- APPENDED
 *   INTERSECT(M, UNION, ALL)      sum a d c a x b x xx   -- tree order restored
 *
 * `UNION` appends the second set to the first; the indentation, however, needs
 * the tree order. `INTERSECT` with `ALL` restores it (order of the FIRST set,
 * occurrences preserved) and is insensitive to the order of the union.
 * Without `ALL`, `UNION` deduplicates and loses occurrences (241 instead of
 * 548 on `Stations`).
 */
describe('several levels at once', () => {
  it('ONE level stays the simple expression', () => {
    expect(storedMdx(mit({ kind: 'level', levels: [0] }), 'aa', 'aa'))
      .toBe(`{TM1FILTERBYLEVEL(${S}, 0)}`);
  });

  it('SEVERAL appear as further arguments — TM1FILTERBYLEVEL is variadic', () => {
    // Hint by flameY3T1, 2026-08-23; re-measured live. The tower of `UNION` +
    // `INTERSECT` that used to be built here returns exactly the same character
    // by character, but on 1.63 million it costs 1416 ms against 296 ms.
    expect(storedMdx(mit({ kind: 'level', levels: [0, 1] }), 'aa', 'aa'))
      .toBe(`{TM1FILTERBYLEVEL(${S}, 0, 1)}`);
  });

  it('three levels stay one call', () => {
    expect(storedMdx(mit({ kind: 'level', levels: [0, 1, 2] }), 'aa', 'aa'))
      .toBe(`{TM1FILTERBYLEVEL(${S}, 0, 1, 2)}`);
  });

  it('no level is no layer', () => {
    expect(storedMdx(mit({ kind: 'level', levels: [] }), 'aa', 'aa')).toBe(S);
  });

  it('the predicate lets every named level through', () => {
    const l: FilterLayer = { kind: 'level', levels: [0, 2] };
    expect(matchesLayer({ name: 'a', type: 'N', level: 0 }, l)).toBe(true);
    expect(matchesLayer({ name: 'a', type: 'C', level: 2 }, l)).toBe(true);
    expect(matchesLayer({ name: 'a', type: 'C', level: 1 }, l)).toBe(false);
  });

  it('the trail names all of them', () => {
    expect(layerLabel({ kind: 'level', levels: [0, 2] })).toContain('0, 2');
  });
});

describe('the selection toggles levels ON and OFF', () => {
  it('each choice adds a level', () => {
    let v = setLevelFilter(initialView('tree'), 0);
    v = setLevelFilter(v, 2);
    expect(currentLevels(v)).toEqual([0, 2]);
  });

  it('the same level once more removes it', () => {
    // The field is a MENU and jumps back after every choice — so it cannot
    // show the state. Toggling is the only interaction that allows a
    // multiple selection without a state display.
    let v = setLevelFilter(initialView('tree'), 0);
    v = setLevelFilter(v, 1);
    v = setLevelFilter(v, 0);
    expect(currentLevels(v)).toEqual([1]);
  });

  it('removing the last one removes the layer entirely', () => {
    let v = setLevelFilter(initialView('tree'), 0);
    v = setLevelFilter(v, 0);
    expect(v.intents).toEqual([]);
  });

  it('`null` clears all of them at once', () => {

    let v = setLevelFilter(initialView('tree'), 0);
    v = setLevelFilter(v, 1);
    v = setLevelFilter(v, null);
    expect(v.intents).toEqual([]);
  });
});
