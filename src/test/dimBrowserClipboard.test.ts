import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, onViewRows, currentMdx, clipboardNames, cutMarked, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { toggleMark, markCount, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';

let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
const zeile = (name: string, caption?: string) => ({
  name, caption: caption ?? name, type: 'N' as const, level: 0, parent: null, ancestors: [], drilled: false,
});
function antworte(namen: string[], beschriftungen?: Record<string, string>): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
    ok: true, rows: namen.map((n) => zeile(n, beschriftungen?.[n])), cardinality: namen.length, hasMore: false,
  } as never);
}

/**
 * Ctrl+C/X and "Copy names" were three deliberate placeholders in the new path
 * from plan 9 — they read `state._markedNames`/`_manualRows`, which it does not
 * keep, and reported themselves instead of taking effect (click test 2026-08-23).
 */
describe('copying from the view', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetMarksForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('copies the marked rows in DRAWING order, ONCE per element', () => {
    // Not in marking order: copying follows the order on screen.
    // But one row per mark — `a` hangs under two parents, it is selected
    // once (click test by flameY3T1, 2026-09-20: "with single ones selected that never
    // makes sense"). Until then `['a', 'a', 'c']` came out here.
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'a', 'c']);
    toggleMark('c');
    toggleMark('a');
    expect(clipboardNames()).toEqual(['a', 'c']);
  });

  it('without a mark the repetitions stay — that is the display', () => {
    // The contiguous case: the tree is copied as it stands. There
    // the second occurrence carries meaning (it hangs under a different
    // parent), whereas a single selection means only ONE element.
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'a', 'c']);
    expect(clipboardNames()).toEqual(['a', 'b', 'a', 'c']);
  });

  it('likewise cuts an element drawn several times only ONCE', () => {
    // `cutMarked` goes through the same function, and `EXCEPT` hits every
    // occurrence anyway — two rows would be doubly wrong here.
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'a']);
    toggleMark('a');
    expect(cutMarked()).toEqual(['a']);
  });

  it('copies what is DISPLAYED — so under an alias, the alias value', () => {
    // Click test by flameY3T1 2026-08-23: the principal name was always copied, even when
    // the row was shown under an alias. It still round-trips: TM1
    // resolves an alias value in a member reference (measured live,
    // `[Stations].[Stations].[SALES Buchungskreis]` returns `A12`), so
    // pasting finds the row again.
    startView('aa', 'aa', post);
    antworte(['A12', 'A13'], { A12: 'SALES Buchungskreis' });
    expect(clipboardNames()).toEqual(['SALES Buchungskreis', 'A13']);
  });

  it('without a mark it copies ALL visible rows', () => {
    // The old path output nothing here. But "Copy" without a selection means the
    // display — and an empty clipboard would be worse than the list
    // that is shown.
    startView('aa', 'aa', post);
    antworte(['a', 'b']);
    expect(clipboardNames()).toEqual(['a', 'b']);
  });

  it('a mark hidden behind a filter falls back to the name set', () => {
    // Otherwise there would be nothing to output, although something IS marked.
    startView('aa', 'aa', post);
    antworte(['a', 'b']);
    toggleMark('a');
    antworte(['b']);
    expect(clipboardNames()).toEqual(['a']);
  });
});

describe('cutting', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetMarksForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('returns the names AND removes them from the set', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c']);
    toggleMark('b');
    expect(cutMarked()).toEqual(['b']);
    expect(currentMdx()).toContain('EXCEPT');
    expect(currentMdx()).toContain('[aa].[aa].[b]');
    // The mark has passed into the layer and stands in the trail.
    expect(markCount()).toBe(0);
  });

  it('without a mark it cuts NOTHING — otherwise the display would be gone', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b']);
    expect(cutMarked()).toEqual([]);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });
});
