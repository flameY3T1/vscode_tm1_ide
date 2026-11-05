import { describe, it, expect } from 'vitest';
import {
  removedOccurrences, occKey, computeBlockOrdinals, isSubsequenceOf, toggleFilterNames,
  axisBaseFromTuples, axisBaseNamesFromMatrix,
} from '../../../webviewClient/cubeViewerMonaco/gridPure';

/**
 * Collapsing in the Cube Viewer should work without the server: the rows are already
 * in the loaded matrix, they only have to disappear. Which rows those are is
 * DERIVED instead of tracked incrementally — base list (the sequence of names from which the
 * matrix was built) against the current selection. That way several
 * collapse steps compose without bookkeeping, and a state that the derivation cannot
 * explain would rather hide nothing than the wrong thing.
 *
 * Addressing is by (name, block ordinal) — the same scheme that
 * `computeBlockOrdinals` provides for the glyph and the click. Names alone are
 * not enough: the same consolidation may appear twice on one axis, and an
 * element that the user dragged ABOVE its consolidation in the Dimension Browser
 * no longer belongs in its block (live bug report 2026-08-01).
 */

describe('removedOccurrences', () => {
  it('reports nothing when nothing has changed', () => {
    expect(removedOccurrences(['A', 'B'], ['A', 'B']).size).toBe(0);
  });

  it('names the occurrence position that disappeared', () => {
    const gone = removedOccurrences(['Top', 'A', 'B'], ['Top']);
    expect([...gone].sort()).toEqual([occKey('A', 0), occKey('B', 0)]);
  });

  it('distinguishes two blocks with the same name', () => {
    // Total appears twice on the axis; only the SECOND block collapses.
    const base = ['Total', 'A', 'Total', 'A'];
    const now = ['Total', 'A', 'Total'];
    const gone = removedOccurrences(base, now);
    expect([...gone]).toEqual([occKey('A', 1)]);
  });

  it('counts ordinals over the base list, not over the remainder', () => {
    const gone = removedOccurrences(['X', 'X', 'X'], ['X']);
    expect([...gone].sort()).toEqual([occKey('X', 1), occKey('X', 2)]);
  });

  it('hides nothing when the selection is NOT a subsequence of the base list', () => {
    // After an expand, the selection contains names that the matrix does not
    // have yet. Until the server answers, nothing may disappear.
    expect(removedOccurrences(['Top'], ['Top', 'Neu']).size).toBe(0);
    expect(removedOccurrences(['A', 'B'], ['B', 'A']).size).toBe(0);
  });

  it('hides nothing when there is no base list', () => {
    expect(removedOccurrences([], ['A']).size).toBe(0);
  });

  it('matches the ordinals that the renderer gives the rows', () => {
    // An axis with two blocks of Total; the second one is collapsed.
    const tuples = [['Total'], ['A'], ['B'], ['Total'], ['A'], ['B']];
    const ords = computeBlockOrdinals(tuples, 0);
    const gone = removedOccurrences(
      ['Total', 'A', 'B', 'Total', 'A', 'B'],
      ['Total', 'A', 'B', 'Total'],
    );
    const hidden = tuples.map((t, i) => gone.has(occKey(t[0], ords[i])));
    expect(hidden).toEqual([false, false, false, false, true, true]);
  });

  it('makes the expand-and-collapse cycle of the same node server-free', () => {
    // The flow by example: `D PL 010 Umsätze` was expanded once, the
    // server delivered the matrix with the children — from here on that is the
    // base list. Collapsing and re-expanding afterwards both move
    // within this list.
    const base = ['Ergebnis', 'GUV001', 'U1', 'U2', 'GUV002'];
    const kids = ['U1', 'U2'];

    const collapsed = toggleFilterNames(base, 'GUV001', kids, kids, base.indexOf('GUV001'));
    expect(collapsed).toEqual(['Ergebnis', 'GUV001', 'GUV002']);
    expect(isSubsequenceOf(collapsed, base)).toBe(true);
    expect([...removedOccurrences(base, collapsed)].sort())
      .toEqual([occKey('U1', 0), occKey('U2', 0)]);

    const reopened = toggleFilterNames(collapsed, 'GUV001', kids, kids, collapsed.indexOf('GUV001'));
    expect(reopened).toEqual(base);
    expect(isSubsequenceOf(reopened, base)).toBe(true);
    expect(removedOccurrences(base, reopened).size).toBe(0);
  });

  it('hits the same occurrence in EVERY outer block on a nested axis', () => {
    // Years on the outside, accounts on the inside: the account list repeats for each year, and
    // `computeBlockOrdinals` resets its count per outer block. A
    // collapsed occurrence must therefore disappear in every year — this is exactly how
    // the server also rebuilds the axis from the list of names.
    const tuples = [
      ['2024', 'Top'], ['2024', 'A'],
      ['2025', 'Top'], ['2025', 'A'],
    ];
    const ords = computeBlockOrdinals(tuples, 1);
    const gone = removedOccurrences(['Top', 'A'], ['Top']);
    const hidden = tuples.map((t, i) => gone.has(occKey(t[1], ords[i])));
    expect(hidden).toEqual([false, true, false, true]);
  });
});

/**
 * A freshly opened view has NO explicit element selection — its axis
 * comes from the saved subsets. The base list must therefore be readable from the
 * loaded matrix, otherwise "Keep only" falls back to the server the first time
 * and only works after some reload has left a selection
 * behind (live observation 2026-08-08).
 *
 * What is read is what `computeBlockOrdinals` counts as a block: the same outer
 * prefix and the same name = one block. If the sequence does not repeat the same way in every
 * outer block, the axis is not a clean cross product — then rather
 * no base list than an invented one.
 */
describe('axisBaseFromTuples', () => {
  it('reads the block sequence of a simple axis', () => {
    expect(axisBaseFromTuples([['A'], ['B'], ['C']], 0)).toEqual(['A', 'B', 'C']);
  });

  it('keeps the same name as TWO blocks when it appears twice', () => {
    expect(axisBaseFromTuples([['Total'], ['A'], ['Total']], 0)).toEqual(['Total', 'A', 'Total']);
  });

  it('merges consecutive identical values into one block', () => {
    // Two rows with the same account (because the inner dimension varies) are
    // ONE block — that is exactly how `computeBlockOrdinals` counts.
    const tuples = [['K1', 'X'], ['K1', 'Y'], ['K2', 'X'], ['K2', 'Y']];
    expect(axisBaseFromTuples(tuples, 0)).toEqual(['K1', 'K2']);
  });

  it('reads the inner dimension as the sequence repeated per outer block', () => {
    const tuples = [['K1', 'X'], ['K1', 'Y'], ['K2', 'X'], ['K2', 'Y']];
    expect(axisBaseFromTuples(tuples, 1)).toEqual(['X', 'Y']);
  });

  it('tolerates a GAP in the inner sequence — that is zero suppression', () => {
    // Click test flameY3T1 2026-08-08: with zero suppression, a different combination is missing
    // in each outer block, so the blocks are never equal. Requiring equality
    // therefore took the base list away from EVERY inner axis dimension — the
    // outermost kept it, because its prefix is empty and there is only ONE
    // block to compare there. That was exactly the finding "only the first
    // dimension is fast".
    const tuples = [['K1', 'X'], ['K1', 'Y'], ['K2', 'X']];
    expect(axisBaseFromTuples(tuples, 1)).toEqual(['X', 'Y']);
  });

  it('also includes a name that only a later block has', () => {
    const tuples = [['K1', 'X'], ['K2', 'X'], ['K2', 'Y']];
    expect(axisBaseFromTuples(tuples, 1)).toEqual(['X', 'Y']);
  });

  it('refuses to answer when the blocks CONTRADICT each other', () => {
    // Not merely a gap: here Y comes before X and elsewhere X before Y. There is
    // no single order that both fit (for example an MDX axis).
    const tuples = [['K1', 'X'], ['K1', 'Y'], ['K2', 'Y'], ['K2', 'X']];
    expect(axisBaseFromTuples(tuples, 1)).toBeNull();
  });

  it('refuses to answer for a gap AND a duplicate name in the block', () => {
    // A name that appears TWICE in a block (element under two parents)
    // is exactly the case the block ordinals exist for. Across unequal
    // blocks the occurrence can no longer be addressed safely —
    // then rather go to the server than hide the wrong row.
    const tuples = [['K1', 'X'], ['K1', 'Y'], ['K1', 'X'], ['K2', 'X']];
    expect(axisBaseFromTuples(tuples, 1)).toBeNull();
  });

  it('hides the right rows across a gap', () => {
    // The proof that the base list built from gaps matches the ordinals of the
    // renderer: `computeBlockOrdinals` counts PER BLOCK and per name, so an
    // element missing from a block shifts nothing there.
    const tuples = [['K1', 'X'], ['K1', 'Y'], ['K2', 'X']];
    const base = axisBaseFromTuples(tuples, 1)!;
    const ords = computeBlockOrdinals(tuples, 1);
    // Keep only X: the Y row goes, both X rows stay.
    const gone = removedOccurrences(base, ['X']);
    expect(tuples.map((t, i) => gone.has(occKey(t[1], ords[i]))))
      .toEqual([false, true, false]);
  });

  it('returns null without rows', () => {
    expect(axisBaseFromTuples([], 0)).toBeNull();
  });

  it('matches the ordinals of the renderer', () => {
    const tuples = [['Total'], ['A'], ['Total'], ['A']];
    const base = axisBaseFromTuples(tuples, 0)!;
    const ords = computeBlockOrdinals(tuples, 0);
    // Second Total block collapsed: its A disappears, the first one stays.
    const gone = removedOccurrences(base, ['Total', 'A', 'Total']);
    expect(tuples.map((t, i) => gone.has(occKey(t[0], ords[i]))))
      .toEqual([false, false, false, true]);
  });
});

describe('isSubsequenceOf', () => {
  it('answers the question "is the loaded matrix enough for this selection?"', () => {
    expect(isSubsequenceOf(['A', 'C'], ['A', 'B', 'C'])).toBe(true);
    expect(isSubsequenceOf(['A', 'B', 'C'], ['A', 'B', 'C'])).toBe(true);
    expect(isSubsequenceOf([], ['A'])).toBe(true);
  });

  it('says no as soon as a name is missing or the order does not match', () => {
    // An expand whose children the matrix never had → must go to the server.
    expect(isSubsequenceOf(['A', 'Neu'], ['A', 'B'])).toBe(false);
    // Reordered is not hiding — that also belongs on the server.
    expect(isSubsequenceOf(['B', 'A'], ['A', 'B'])).toBe(false);
    expect(isSubsequenceOf(['A', 'A'], ['A'])).toBe(false);
  });
});

describe('axisBaseNamesFromMatrix', () => {
  it('reads the base list of every row and column dimension', () => {
    expect(axisBaseNamesFromMatrix({
      rowElements: [], colElements: [],
      rowTuples: [['A', 'X'], ['A', 'Y'], ['B', 'X'], ['B', 'Y']],
      colTuples: [['P'], ['Q']],
      rowDims: ['D1', 'D2'], colDims: ['D3'],
    })).toEqual({ D1: ['A', 'B'], D2: ['X', 'Y'], D3: ['P', 'Q'] });
  });

  it('leaves out a dimension whose axis cannot be explained', () => {
    const map = axisBaseNamesFromMatrix({
      rowElements: [], colElements: [],
      // X before Y, then Y before X — a real contradiction, not a gap.
      rowTuples: [['A', 'X'], ['A', 'Y'], ['B', 'Y'], ['B', 'X']],
      colTuples: [['P']],
      rowDims: ['D1', 'D2'], colDims: ['D3'],
    });
    expect(map.D1).toEqual(['A', 'B']);
    expect(map.D2).toBeUndefined();
    expect(map.D3).toEqual(['P']);
  });

  it('makes do with the element names when no tuples came along', () => {
    expect(axisBaseNamesFromMatrix({
      rowElements: ['A', 'B'], colElements: ['P'],
      rowDims: ['D1'], colDims: ['D3'],
    })).toEqual({ D1: ['A', 'B'], D3: ['P'] });
  });
});
