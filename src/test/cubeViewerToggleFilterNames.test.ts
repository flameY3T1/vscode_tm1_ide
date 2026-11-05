import { describe, it, expect } from 'vitest';
import { toggleFilterNames } from '../webviewClient/cubeViewerMonaco/gridPure';

/**
 * Task 8 step 1/2 of the plan `2026-08-10-cubeviewer-axis-meta-scoping.md`.
 *
 * The click path itself is close to the DOM and cannot sensibly be tested here. Testable —
 * and exactly the point at which the rework can silently go wrong — is the
 * result equality of the descendant list restricted to the filter list:
 * since Task 6 the host delivers `descendants` only within `within`
 * (= `sel.names`). If that were not result-equal, a click after the
 * rework would expand too much or too little, without anything crashing.
 */
describe('toggleFilterNames with a restricted descendant list', () => {
  const names = ['wurzel', 'a', 'a1', 'x'];
  const immediate = ['a', 'b'];
  const vollständig = ['a', 'a1', 'b', 'b1'];
  const beschränkt = ['a', 'a1']; // = complete ∩ names

  it('returns the same result as with the full list', () => {
    expect(toggleFilterNames(names, 'wurzel', immediate, beschränkt, 0))
      .toEqual(toggleFilterNames(names, 'wurzel', immediate, vollständig, 0));
  });

  it('stays the same when no descendant stands in the list (expand case)', () => {
    // Both times there is nothing to fetch below `wurzel` → expand.
    const nurWurzel = ['wurzel', 'x'];
    expect(toggleFilterNames(nurWurzel, 'wurzel', immediate, [], 0))
      .toEqual(toggleFilterNames(nurWurzel, 'wurzel', immediate, vollständig, 0));
  });

  it('stays the same when a descendant was parked ABOVE the parent', () => {
    // Position rule from `hasCandidateBelow`: `a1` stands above `wurzel`
    // and does not count as "hangs below it". The restriction must not change anything
    // about that — it only strikes names that are not in the list at all anyway.
    const verschoben = ['a1', 'wurzel', 'a', 'x'];
    expect(toggleFilterNames(verschoben, 'wurzel', immediate, ['a', 'a1'], 1))
      .toEqual(toggleFilterNames(verschoben, 'wurzel', immediate, vollständig, 1));
  });

  it('is equal even without a position given', () => {
    expect(toggleFilterNames(names, 'wurzel', immediate, beschränkt))
      .toEqual(toggleFilterNames(names, 'wurzel', immediate, vollständig));
  });
});
