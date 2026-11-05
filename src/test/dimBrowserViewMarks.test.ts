import { describe, it, expect, beforeEach } from 'vitest';
import {
  isMarked, toggleMark, markRange, markAll, clearMarks, markedNames, markCount,
  lastClicked, _resetMarksForTest,
} from '../webviewClient/dimensionBrowser/viewMarks';
import type { DisplayRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import { viewRowsHtml } from '../webviewClient/dimensionBrowser/viewRender';
import {
  startView, onViewRows, currentRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

function zeile(name: string, key = name): DisplayRow {
  return {
    name, caption: name, type: 'N', level: 0, parent: null, drilled: false,
    ancestors: [], depth: 0, key,
  };
}

describe('marking is SINGLE-LEVEL — on the element, not the occurrence', () => {
  beforeEach(() => { _resetMarksForTest(); });

  it('one click marks, the next one takes it back', () => {
    toggleMark('a');
    expect(isMarked('a')).toBe(true);
    toggleMark('a');
    expect(isMarked('a')).toBe(false);
  });

  it('the same ELEMENT under two parents is ONE mark', () => {
    // The core of the decision: `a` stands under `sum` and under `d`. A
    // click on either of the two rows lights up BOTH, because a
    // later removal also hits both (EXCEPT(..., ALL)).
    const unterSum = zeile('a', 'sum\x00a');
    const unterD = zeile('a', 'd\x00a');
    toggleMark(unterSum.name);
    expect(isMarked(unterSum.name)).toBe(true);
    expect(isMarked(unterD.name)).toBe(true);
    expect(markCount()).toBe(1);
  });

  it('markRange marks over the DRAWN rows, bounds inclusive', () => {
    const rows = [zeile('a'), zeile('b'), zeile('c'), zeile('d')];
    markRange(rows, 1, 2);
    expect(markedNames().sort()).toEqual(['b', 'c']);
  });

  it('markRange also works backwards', () => {
    // A Shift-click UPWARDS is the same range as downwards.
    const rows = [zeile('a'), zeile('b'), zeile('c'), zeile('d')];
    markRange(rows, 3, 1);
    expect(markedNames().sort()).toEqual(['b', 'c', 'd']);
  });

  it('markRange counts the same element in the range only once', () => {
    const rows = [zeile('a', 'sum\x00a'), zeile('a', 'd\x00a'), zeile('b')];
    markRange(rows, 0, 2);
    expect(markCount()).toBe(2);
  });

  it('markAll takes all loaded rows', () => {
    markAll([zeile('a'), zeile('b')]);
    expect(markedNames().sort()).toEqual(['a', 'b']);
  });

  it('clearMarks clears everything', () => {
    markAll([zeile('a'), zeile('b')]);
    clearMarks();
    expect(markCount()).toBe(0);
    expect(markedNames()).toEqual([]);
  });
});

describe('the drawn row shows the mark', () => {
  beforeEach(() => { _resetMarksForTest(); });

  it('no class without a mark', () => {
    const html = viewRowsHtml([zeile('a')], 0, isMarked);
    expect(html).toContain('class="vw-row"');
    expect(html).not.toContain('row-marked');
  });

  it('with a mark, the class row-marked', () => {
    toggleMark('a');
    const html = viewRowsHtml([zeile('a')], 0, isMarked);
    expect(html).toContain('row-marked');
  });

  it('BOTH occurrences of the same element light up', () => {
    toggleMark('a');
    const html = viewRowsHtml([zeile('a', 'sum\x00a'), zeile('a', 'd\x00a')], 0, isMarked);
    expect(html.match(/row-marked/g)).toHaveLength(2);
  });
});

/**
 * Fix round 1 (review): `bindClick` (viewPath.ts) had no automated
 * coverage — this is the only test that simulates clicks on `#table-body` at
 * all. Without it, a future rework of the click delegate could silently
 * bring back the PRE-task-4 collision (EVERY click on the row toggles
 * expansion).
 *
 * A "server answer row" (AnswerRow), not the DisplayRow from above — the
 * rows that `bindClick` sees come via `onViewRows`/`rowsFromAnswer`.
 */
function antwortZeile(name: string, ancestors: string[] = [], drilled = false) {
  return {
    name,
    caption: name,
    type: drilled ? 'C' : 'N',
    level: drilled ? 1 : 0,
    parent: ancestors.length ? ancestors[ancestors.length - 1] : null,
    ancestors: ancestors.map((n) => ({ name: n, type: 'N' as const, level: 0 })),
    drilled,
  };
}

/**
 * A click event as the REAL handler in `bindClick` receives it:
 * `target.classList.contains('vw-twisty')` distinguishes the triangle from the row,
 * `target.closest('tr')` supplies the position via `data-idx`.
 */
function klickAuf(idx: number, aufDreieck: boolean, shiftKey = false) {
  return {
    shiftKey,
    target: {
      classList: { contains: (c: string) => aufDreieck && c === 'vw-twisty' },
      closest: (sel: string) => (
        sel === 'tr' ? { getAttribute: (a: string) => (a === 'data-idx' ? String(idx) : null) } : null
      ),
    },
  };
}

describe('bindClick separates expand click and mark click (viewPath.ts)', () => {
  let posted: { type: string; requestId?: number }[] = [];
  let clickHandler: ((e: unknown) => void) | null = null;

  beforeEach(() => {
    _resetMarksForTest();
    _resetViewPathForTest();
    posted = [];
    clickHandler = null;
    const tableBody = {
      innerHTML: '',
      addEventListener: (t: string, h: (e: unknown) => void) => { if (t === 'click') { clickHandler = h; } },
      insertAdjacentHTML: () => { /* appending is not needed in these tests */ },
      querySelectorAll: () => [] as unknown[],
    };
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (id === 'table-body' ? tableBody : null),
    };
    startView('aa', 'aa', (m) => { posted.push(m as never); });
    const anfrage = posted.find((p) => p.type === 'fetchViewRows')!;
    onViewRows({
      type: 'viewRows', requestId: anfrage.requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [
        antwortZeile('sum', [], true),
        antwortZeile('a', ['sum']),
        antwortZeile('b', ['sum']),
        antwortZeile('c', ['sum']),
      ],
      hasMore: false,
    } as never);
  });

  const fetchCount = () => posted.filter((p) => p.type === 'fetchViewRows').length;

  it('a click on the triangle expands/collapses — and does NOT mark', () => {
    const vorher = fetchCount();
    clickHandler!(klickAuf(0, true));
    // `toggleAt` flips the intent and calls `fetchRows()` — a further request
    // is the proof that the toggle happened.
    expect(fetchCount()).toBe(vorher + 1);
    expect(isMarked(currentRows()[0].name)).toBe(false);
    expect(markCount()).toBe(0);
  });

  it('a click on the row marks — and does NOT expand/collapse', () => {
    const vorher = fetchCount();
    clickHandler!(klickAuf(1, false));
    expect(fetchCount()).toBe(vorher);
    expect(isMarked('a')).toBe(true);
    expect(markCount()).toBe(1);
  });

  it('Shift-click marks the range since the last click', () => {
    clickHandler!(klickAuf(1, false));
    const vorher = fetchCount();
    clickHandler!(klickAuf(3, false, true));
    expect(fetchCount()).toBe(vorher);
    expect(markedNames().sort()).toEqual(['a', 'b', 'c']);
    expect(isMarked('sum')).toBe(false);
  });
});

/**
 * Important 1 (final review): `lastClickPosition` is a POSITION, not a
 * mark. Marks (names) deliberately survive `toggleAt`/`applyFilter`/
 * `popLayer` — the anchor NO LONGER survives that: a REPLACED row set
 * (expand click, filter, base change) invalidates the old position, and
 * without a reset a following Shift-click marks "up to the end" of the new,
 * usually much shorter list — exactly the journey from the final review
 * (click on row 800, collapse to 5 rows, Shift-click on row 3).
 */
describe('the Shift anchor becomes invalid when the row set is REPLACED (Important 1)', () => {
  let posted: { type: string; requestId?: number; mdx?: string }[] = [];
  let clickHandler: ((e: unknown) => void) | null = null;

  beforeEach(() => {
    _resetMarksForTest();
    _resetViewPathForTest();
    posted = [];
    clickHandler = null;
    const tableBody = {
      innerHTML: '',
      addEventListener: (t: string, h: (e: unknown) => void) => { if (t === 'click') { clickHandler = h; } },
      insertAdjacentHTML: () => { /* appending is not needed in this test */ },
      querySelectorAll: () => [] as unknown[],
    };
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (id === 'table-body' ? tableBody : null),
    };
    startView('aa', 'aa', (m) => { posted.push(m as never); });
    const erste = posted.find((p) => p.type === 'fetchViewRows')!;
    // A LARGE window: 'sum' (collapsed) at position 0, then 850 children —
    // position 800 must exist so that the anchor sits far enough down.
    const grosseAntwort = [antwortZeile('sum', [], true)];
    for (let i = 0; i < 850; i++) { grosseAntwort.push(antwortZeile(`e${i}`, ['sum'])); }
    onViewRows({
      type: 'viewRows', requestId: erste.requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: grosseAntwort, hasMore: false,
    } as never);
    expect(currentRows().length).toBeGreaterThan(800);
  });

  it('an expand click replaces the rows and resets the anchor', () => {
    // Set the anchor to position 800 — a plain mark click, no range.
    clickHandler!(klickAuf(800, false));
    expect(lastClicked()).toBe(800);

    // An expand click on 'sum' (position 0) triggers `toggleAt` -> `fetchRows()` —
    // a NEW request whose answer REPLACES the row set (no appending).
    clickHandler!(klickAuf(0, true));
    const zweite = posted.filter((p) => p.type === 'fetchViewRows').at(-1)!;
    onViewRows({
      type: 'viewRows', requestId: zweite.requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [
        antwortZeile('x1'), antwortZeile('x2'), antwortZeile('x3'),
        antwortZeile('x4'), antwortZeile('x5'),
      ],
      hasMore: false,
    } as never);
    expect(currentRows().length).toBe(5);
    // The proof of the fix: the anchor is gone, no longer 800.
    expect(lastClicked()).toBeNull();

    // A Shift-click on the new, short row 3 adds ONLY this ONE
    // row — 'e799' stays marked (marks are names and survive the
    // replacement ON PURPOSE), but NO range is added. WITHOUT the fix
    // the anchor would still be 800 and `markRange(rows, 800, 3)` would mark everything
    // from index 3 to the end of the new, much shorter list (including 'x5').
    clickHandler!(klickAuf(3, false, true));
    expect(markedNames().sort()).toEqual(['e799', 'x4']);
    expect(markCount()).toBe(2);
  });
});
