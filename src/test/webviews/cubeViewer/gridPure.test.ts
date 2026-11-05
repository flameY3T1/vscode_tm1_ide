import { describe, it, expect } from 'vitest';
import { hasData, hasCollapsedAncestorDag, insertChildrenAfterParent, hasChildBelow, toggleFilterNames, nthOccurrenceIndex, computeBlockOrdinals } from '../../../webviewClient/cubeViewerMonaco/gridPure';
import { hasPicklist, cellTakesPicklist } from '../../../webviewClient/cubeViewerMonaco/gridPure';
import type { MatrixData } from '../../../webviewClient/cubeViewerMonaco/state';

describe('hasData', () => {
  it('returns false for null/undefined/empty', () => {
    expect(hasData(null)).toBe(false);
    expect(hasData(undefined)).toBe(false);
    expect(hasData('')).toBe(false);
  });
  it('returns false for numeric zero', () => {
    expect(hasData('0')).toBe(false);
    expect(hasData('0.0')).toBe(false);
    expect(hasData('0,00')).toBe(false);
  });
  it('returns true for non-zero numbers', () => {
    expect(hasData('1')).toBe(true);
    expect(hasData('0.5')).toBe(true);
    expect(hasData('-1')).toBe(true);
    expect(hasData('1.234,56')).toBe(true); // EU format
  });
  it('returns true for non-numeric strings (treat as data)', () => {
    expect(hasData('Lorem')).toBe(true);
    expect(hasData('N/A')).toBe(true);
  });
  it('returns true for formatted currency-like strings', () => {
    expect(hasData('$1,000.50')).toBe(true);
    expect(hasData('€ 42')).toBe(true);
  });
  it('returns false for stripped zero with thousand separators', () => {
    expect(hasData('0,0')).toBe(false);
  });
});

describe('hasCollapsedAncestorDag (multi-parent collapse)', () => {
  it('hides a child when a NON-first parent is collapsed (the real-model leak)', () => {
    // C is shown under P but its first parent is Q; only P is collapsed.
    const allParents = { C: ['Q', 'P'], P: ['R'], Q: ['R'] };
    expect(hasCollapsedAncestorDag('C', allParents, { P: true })).toBe(true);
  });
  it('hides via a deeper ancestor path', () => {
    const allParents = { GC: ['C'], C: ['P'], P: ['R'] };
    expect(hasCollapsedAncestorDag('GC', allParents, { P: true })).toBe(true);
  });
  it('returns false when no ancestor on any path is collapsed', () => {
    const allParents = { C: ['Q', 'P'], P: ['R'], Q: ['R'] };
    expect(hasCollapsedAncestorDag('C', allParents, { Z: true })).toBe(false);
  });
  it('does not consider the element itself', () => {
    expect(hasCollapsedAncestorDag('self', { self: ['p'] }, { self: true })).toBe(false);
  });
  it('is cycle-safe over the DAG', () => {
    expect(hasCollapsedAncestorDag('A', { A: ['B'], B: ['A'] }, { Z: true })).toBe(false);
  });

  // Since the axis trimming, `all` ONLY holds elements with multiple parents
  // (`axisMetaScopePure.ts`) — the single-parent majority is only in `first`.
  // Without the fallback, the climb stops at the first such link.
  describe('fallback to the first map (trimmed payload)', () => {
    it('finds the collapsed parent that is only in first', () => {
      expect(hasCollapsedAncestorDag('C', {}, { P: true }, { C: 'P' })).toBe(true);
    });
    it('climbs over a mixed chain: all → first → all', () => {
      // C has multiple parents, P a single parent (only first), R multiple parents.
      const all = { C: ['P', 'Q'], R: ['S', 'T'] };
      const first = { C: 'P', P: 'R', R: 'S' };
      expect(hasCollapsedAncestorDag('C', all, { T: true }, first)).toBe(true);
    });
    it('stays false when nothing is collapsed on any path', () => {
      expect(hasCollapsedAncestorDag('C', {}, { Z: true }, { C: 'P', P: 'R' })).toBe(false);
    });
    it('prefers all over first when both say something', () => {
      // The `first` path ends at X (not collapsed); the second parent Y is.
      expect(hasCollapsedAncestorDag('C', { C: ['X', 'Y'] }, { Y: true }, { C: 'X' })).toBe(true);
    });
    it('stays cycle-safe when the cycle runs through first', () => {
      expect(hasCollapsedAncestorDag('A', {}, { Z: true }, { A: 'B', B: 'A' })).toBe(false);
    });
    it('unchanged without a first map (the fallback is optional)', () => {
      expect(hasCollapsedAncestorDag('C', {}, { P: true })).toBe(false);
    });
  });
});

describe('insertChildrenAfterParent', () => {
  it('inserts children directly AFTER the parent, not at the end (the bug)', () => {
    // Parent P sits in the middle; expanding it must place its kids under it,
    // NOT below the last dimension element Z.
    const base = ['A', 'P', 'Z'];
    expect(insertChildrenAfterParent(base, 'P', ['C1', 'C2'])).toEqual(['A', 'P', 'C1', 'C2', 'Z']);
  });
  it('appends the parent first when it is absent, then its children', () => {
    expect(insertChildrenAfterParent(['A', 'Z'], 'P', ['C1'])).toEqual(['A', 'Z', 'P', 'C1']);
  });
  it('skips children already present BELOW the parent (no duplicates, no reorder)', () => {
    const base = ['A', 'P', 'C1', 'Z'];
    expect(insertChildrenAfterParent(base, 'P', ['C1', 'C2'])).toEqual(['A', 'P', 'C2', 'C1', 'Z']);
  });
  it('re-inserts a child that sits ABOVE the parent (the duplicate is wanted)', () => {
    // Live bug report 2026-08-01: C1 was dragged above P in the Dimension
    // Browser. Collapsing P leaves it up there (position-aware, 810a3854), so
    // expanding P must show it a SECOND time inside P's block — otherwise the
    // child is simply missing from the expanded consolidation.
    expect(insertChildrenAfterParent(['C1', 'P', 'Z'], 'P', ['C1', 'C2']))
      .toEqual(['C1', 'P', 'C1', 'C2', 'Z']);
  });
  it('inserts after the parent when the parent is the last element', () => {
    expect(insertChildrenAfterParent(['A', 'P'], 'P', ['C1', 'C2'])).toEqual(['A', 'P', 'C1', 'C2']);
  });
  it('does not mutate the input array', () => {
    const base = ['A', 'P', 'Z'];
    insertChildrenAfterParent(base, 'P', ['C1']);
    expect(base).toEqual(['A', 'P', 'Z']);
  });
  it('inserts under the addressed occurrence of a duplicated parent (K7)', () => {
    const base = ['P', 'A', 'P', 'Z'];
    expect(insertChildrenAfterParent(base, 'P', ['C1'], 2)).toEqual(['P', 'A', 'P', 'C1', 'Z']);
    expect(insertChildrenAfterParent(base, 'P', ['C1'], 0)).toEqual(['P', 'C1', 'A', 'P', 'Z']);
  });
  it('only skips children already inside the addressed block', () => {
    // C1 hangs under the SECOND P, so expanding the first one must still list
    // it there — the "already below" check stops at the next occurrence.
    const base = ['P', 'A', 'P', 'C1', 'Z'];
    expect(insertChildrenAfterParent(base, 'P', ['C1'], 0)).toEqual(['P', 'C1', 'A', 'P', 'C1', 'Z']);
  });
});

describe('hasChildBelow', () => {
  it('sees a child that follows the parent', () => {
    expect(hasChildBelow(['P', 'C1', 'Z'], 'P', ['C1', 'C2'])).toBe(true);
  });
  it('ignores a child that was moved ABOVE the parent', () => {
    // The child no longer hangs under P in the displayed order, so P counts
    // as collapsed even though the name is still in the list.
    expect(hasChildBelow(['C1', 'P', 'Z'], 'P', ['C1', 'C2'])).toBe(false);
  });
  it('treats every position as below when the parent itself is absent', () => {
    expect(hasChildBelow(['C1', 'Z'], 'P', ['C1'])).toBe(true);
  });
  it('returns false without children', () => {
    expect(hasChildBelow(['P', 'Z'], 'P', [])).toBe(false);
  });

  // ── Duplicated parent: each occurrence owns its own block (K7) ──────────
  // Since the 2026-08-01 rework a member may sit on an axis more than once, so
  // resolving the parent by name would always answer for the FIRST block.
  it('answers for the clicked occurrence, not the first one', () => {
    const names = ['P', 'C1', 'C2', 'P', 'Z'];
    // First P is expanded …
    expect(hasChildBelow(names, 'P', ['C1', 'C2'], 0)).toBe(true);
    // … the second one is not — its block holds only Z.
    expect(hasChildBelow(names, 'P', ['C1', 'C2'], 3)).toBe(false);
  });
  it('does not let a later block count as the earlier block\'s children', () => {
    const names = ['P', 'X', 'P', 'C1', 'C2', 'Z'];
    // The first P's block ends at the second P, so C1/C2 belong to that one.
    expect(hasChildBelow(names, 'P', ['C1', 'C2'], 0)).toBe(false);
    expect(hasChildBelow(names, 'P', ['C1', 'C2'], 2)).toBe(true);
  });
  it('falls back to the first occurrence when the index is stale', () => {
    // A click carrying an index from an older render must never address a
    // foreign element — it degrades to the historic by-name lookup.
    const names = ['P', 'C1', 'Z'];
    expect(hasChildBelow(names, 'P', ['C1'], 2)).toBe(true);
    expect(hasChildBelow(names, 'P', ['C1'], 99)).toBe(true);
    expect(hasChildBelow(names, 'P', ['C1'], -1)).toBe(true);
  });
});

describe('nthOccurrenceIndex', () => {
  it('finds the n-th occurrence', () => {
    const names = ['P', 'C1', 'P', 'Z', 'P'];
    expect(nthOccurrenceIndex(names, 'P', 0)).toBe(0);
    expect(nthOccurrenceIndex(names, 'P', 1)).toBe(2);
    expect(nthOccurrenceIndex(names, 'P', 2)).toBe(4);
  });
  it('returns -1 beyond the last occurrence / for a missing name', () => {
    expect(nthOccurrenceIndex(['P', 'Z'], 'P', 1)).toBe(-1);
    expect(nthOccurrenceIndex(['P', 'Z'], 'Q', 0)).toBe(-1);
  });
  it('returns -1 for a negative ordinal', () => {
    expect(nthOccurrenceIndex(['P'], 'P', -1)).toBe(-1);
  });
});

describe('computeBlockOrdinals', () => {
  it('numbers the repeated blocks of a single-dim axis', () => {
    const tuples = [['P'], ['C1'], ['C2'], ['P'], ['Z']];
    expect(computeBlockOrdinals(tuples, 0)).toEqual([0, 0, 0, 1, 0]);
  });
  it('keeps one ordinal for consecutive rows of the same block', () => {
    const tuples = [['P'], ['P'], ['A'], ['P']];
    // Rows 0+1 are one rendered block; the P after A is the second one.
    expect(computeBlockOrdinals(tuples, 0)).toEqual([0, 0, 0, 1]);
  });
  it('restarts the count per higher-dim block (cross-join axis)', () => {
    // D0 = [A, B], D1 = [X, Y] → X is the FIRST X inside each D0 block, so the
    // ordinal must reset; otherwise B/X would address D1's non-existent 2nd X.
    const tuples = [['A', 'X'], ['A', 'Y'], ['B', 'X'], ['B', 'Y']];
    expect(computeBlockOrdinals(tuples, 1)).toEqual([0, 0, 0, 0]);
    // Distinct outer names → each is its own first occurrence.
    expect(computeBlockOrdinals(tuples, 0)).toEqual([0, 0, 0, 0]);
  });
  it('numbers a repeated outer dim across its cross-join blocks', () => {
    const tuples = [['A', 'X'], ['A', 'Y'], ['B', 'X'], ['A', 'X']];
    expect(computeBlockOrdinals(tuples, 0)).toEqual([0, 0, 0, 1]);
    // …and the inner dim restarts at 0 inside every outer block.
    expect(computeBlockOrdinals(tuples, 1)).toEqual([0, 0, 0, 0]);
  });
  it('numbers a dim that repeats inside one higher-dim block', () => {
    const tuples = [['A', 'X'], ['A', 'Y'], ['A', 'X']];
    expect(computeBlockOrdinals(tuples, 1)).toEqual([0, 0, 1]);
  });
  it('tolerates short tuples', () => {
    expect(computeBlockOrdinals([[], ['A']], 0)).toEqual([0, 0]);
  });
});

describe('toggleFilterNames', () => {
  it('collapsing drops the descendants that sit under the parent', () => {
    const names = ['A', 'P', 'C1', 'C2', 'Z'];
    expect(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2', 'G1'])).toEqual(['A', 'P', 'Z']);
  });
  it('collapsing keeps a descendant that was moved ABOVE the parent (live bug 2026-08-01)', () => {
    // N was dragged above its consolidation in the Dimension Browser, so it is
    // no longer part of P's block — collapsing P must not swallow it.
    const names = ['A', 'N', 'P', 'C1', 'Z'];
    expect(toggleFilterNames(names, 'P', ['N', 'C1'], ['N', 'C1'])).toEqual(['A', 'N', 'P', 'Z']);
  });
  it('expands when the only descendant sits above the parent — and shows it twice', () => {
    // Nothing left to collapse below P → the click means "expand". N stays at
    // its dragged position AND reappears inside P's block; an expanded
    // consolidation shows all of its children (live report 2026-08-01).
    const names = ['N', 'P', 'Z'];
    expect(toggleFilterNames(names, 'P', ['N', 'C1'], ['N', 'C1'])).toEqual(['N', 'P', 'N', 'C1', 'Z']);
  });
  it('collapse after that re-expand drops only the occurrence below the parent', () => {
    // Round trip of the live report: collapse → expand → collapse must land
    // back on the dragged-up N, never swallow it.
    const names = ['N', 'P', 'N', 'C1', 'Z'];
    expect(toggleFilterNames(names, 'P', ['N', 'C1'], ['N', 'C1'])).toEqual(['N', 'P', 'Z']);
  });
  it('expands by inserting the immediate children right after the parent', () => {
    expect(toggleFilterNames(['A', 'P', 'Z'], 'P', ['C1', 'C2'], ['C1', 'C2'])).toEqual(['A', 'P', 'C1', 'C2', 'Z']);
  });
  it('drops deep descendants too, not just the immediate children', () => {
    const names = ['P', 'C1', 'G1', 'Z'];
    expect(toggleFilterNames(names, 'P', ['C1'], ['C1', 'G1'])).toEqual(['P', 'Z']);
  });
  it('appends the parent when it was not in the list itself', () => {
    expect(toggleFilterNames(['C1', 'Z'], 'P', ['C1'], ['C1'])).toEqual(['Z', 'P']);
  });
  it('does not mutate the input array', () => {
    const names = ['A', 'P', 'C1'];
    toggleFilterNames(names, 'P', ['C1'], ['C1']);
    expect(names).toEqual(['A', 'P', 'C1']);
  });

  // ── Duplicated parent: toggle the block that was clicked (K7) ───────────
  it('expands the SECOND block when its own toggle was clicked', () => {
    // P sits on the axis twice; the first block is expanded, the second is not.
    // Reading the first block's position would collapse it instead.
    const names = ['P', 'C1', 'C2', 'P', 'Z'];
    expect(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2'], 3))
      .toEqual(['P', 'C1', 'C2', 'P', 'C1', 'C2', 'Z']);
  });
  it('collapses only the clicked block when both blocks are expanded', () => {
    const names = ['P', 'C1', 'C2', 'P', 'C1', 'C2', 'Z'];
    expect(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2'], 0))
      .toEqual(['P', 'P', 'C1', 'C2', 'Z']);
    expect(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2'], 3))
      .toEqual(['P', 'C1', 'C2', 'P', 'Z']);
  });
  it('expands the first block without touching the second one\'s children', () => {
    // The first P is empty, the second is expanded. Clicking the first must
    // expand it — not collapse the children hanging under the second.
    const names = ['P', 'X', 'P', 'C1', 'C2', 'Z'];
    expect(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2'], 0))
      .toEqual(['P', 'C1', 'C2', 'X', 'P', 'C1', 'C2', 'Z']);
  });
  it('behaves exactly as before when the parent occurs once', () => {
    const names = ['A', 'P', 'C1', 'C2', 'Z'];
    expect(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2', 'G1'], 1))
      .toEqual(toggleFilterNames(names, 'P', ['C1', 'C2'], ['C1', 'C2', 'G1']));
  });
});

describe('hasPicklist', () => {
  // All MatrixData fields not mentioned are optional — no cast needed.
  const m: MatrixData = {
    rowElements: ['K1'], colElements: ['Txt'], values: { '0,0': 'x' },
    rowDims: ['Konto'], colDims: ['Mass'],
    rowTuples: [['K1']], colTuples: [['Txt']],
  };

  it('recognizes the attribute layer', () => {
    expect(hasPicklist({ ...m, picklistByElem: { Konto: { K1: 'static:A' } } }, 0, 0, ['Konto', 'Mass'], {}))
      .toBe(true);
  });

  it('recognizes the rule layer — the arrow WITHOUT a single cell query', () => {
    // Task 15: the area comes from the rule text of the control cube (1 ms per
    // cube), not from a grid query (> 10 min measured).
    expect(hasPicklist({ ...m, picklistByRuleElem: { K1: 'static:A' } }, 0, 0, ['Konto', 'Mass'], {}))
      .toBe(true);
  });

  it('reports false without any definition', () => {
    expect(hasPicklist(m, 0, 0, ['Konto', 'Mass'], {})).toBe(false);
  });

  it('reports false for an unreadable definition — TM1 allows everything there', () => {
    expect(hasPicklist({ ...m, picklistByRuleElem: { K1: 'unsinn:a' } }, 0, 0, ['Konto', 'Mass'], {}))
      .toBe(false);
  });
});

describe('cellTakesPicklist', () => {
  it('allows the leaf cell — the server sends no flag for it at all', () => {
    expect(cellTakesPicklist(undefined)).toBe(true);
    expect(cellTakesPicklist({})).toBe(true);
  });
  it('weist konsolidierte Zellen ab', () => {
    // A picklist chooses ONE leaf element. On a consolidation the value is
    // spread — the selection would have no recipient there.
    expect(cellTakesPicklist({ c: 1 })).toBe(false);
  });
  it('rejects rule cells and locked cells', () => {
    expect(cellTakesPicklist({ r: 1 })).toBe(false);
    expect(cellTakesPicklist({ u: 0 })).toBe(false);
  });
  it('rejects the consolidated cell even when it is writable', () => {
    // Consolidated AND writable (no `u: 0`) is the normal case —
    // exactly the case in which the arrow used to appear wrongly.
    expect(cellTakesPicklist({ c: 1, r: undefined, u: undefined })).toBe(false);
  });
});
