/**
 * Match selection of the find bar (Ctrl+F) across several sources.
 *
 * Finding 2026-08-04 (process editor): the bar jumped off at the FIRST letter
 * and landed on match 0 — the first match of the FIRST source, i.e. usually
 * in a different tab than the one you were working in. And a word selected
 * by double-click was taken over, but immediately yanked the editor to a
 * different occurrence.
 *
 * Two rules, both checked here in pure form:
 *  - While typing, the ACTIVE tab counts: its first match wins, and only
 *    if it has none does it fall back to the very first match overall.
 *  - When opening with a selection, the match AT the selection is meant, not
 *    just any — otherwise the editor jumps away from what you are looking at.
 */

import { describe, it, expect } from 'vitest';
import {
  firstMatchIdxInSource, pickInitialMatchIdx, matchIdxAtSelection,
} from '../webviewClient/_shared/findPick';

// Prolog has two matches, Data one — the order is the source order.
const MATCHES = [
  { sourceKey: 'prolog', lineNumber: 3, column: 5, length: 4 },
  { sourceKey: 'prolog', lineNumber: 9, column: 1, length: 4 },
  { sourceKey: 'data', lineNumber: 2, column: 7, length: 4 },
];

describe('firstMatchIdxInSource', () => {
  it('finds the first match of a source', () => {
    expect(firstMatchIdxInSource(MATCHES, 'prolog')).toBe(0);
    expect(firstMatchIdxInSource(MATCHES, 'data')).toBe(2);
  });

  it('reports -1 for a source without matches', () => {
    expect(firstMatchIdxInSource(MATCHES, 'epilog')).toBe(-1);
  });
});

describe('pickInitialMatchIdx', () => {
  it('prefers the first match of the active tab', () => {
    expect(pickInitialMatchIdx(MATCHES, 'data')).toBe(2);
  });

  it('falls back to the very first match when the active tab has none', () => {
    expect(pickInitialMatchIdx(MATCHES, 'epilog')).toBe(0);
  });

  it('reports -1 when there are no matches at all', () => {
    expect(pickInitialMatchIdx([], 'prolog')).toBe(-1);
  });

  it('works without a known active source', () => {
    expect(pickInitialMatchIdx(MATCHES, null)).toBe(0);
  });
});

describe('matchIdxAtSelection', () => {
  it('hits exactly the match that starts at the selection', () => {
    expect(matchIdxAtSelection(MATCHES, 'prolog', 9, 1)).toBe(1);
  });

  it('distinguishes sources — the same line/column in another one does not count', () => {
    expect(matchIdxAtSelection(MATCHES, 'data', 9, 1)).toBe(-1);
  });

  it('reports -1 when no match starts at that position', () => {
    expect(matchIdxAtSelection(MATCHES, 'prolog', 3, 6)).toBe(-1);
  });
});
