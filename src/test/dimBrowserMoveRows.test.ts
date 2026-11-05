import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {};
});
vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, onViewRows, insertNamesAt, currentMdx,
  _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { flashBanner } from '../webviewClient/dimensionBrowser/banner';

let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
const zeile = (name: string) => ({
  name, caption: name, type: 'N' as const, level: 0, parent: null, ancestors: [], drilled: false,
});
function antworte(namen: string[], hasMore = false): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
    ok: true, rows: namen.map(zeile), cardinality: namen.length, hasMore,
  } as never);
}
const folge = () => currentMdx()!.replace(/\{|\}|\[aa\]\.\[aa\]\./g, '').replace(/[[\]]/g, '').split(',');

/**
 * Drag and drop is a MANUAL ORDER — the same thing as
 * "insert above/below", only with a grip instead of the clipboard.
 * And the same caveat: it must be able to name the WHOLE set.
 */
describe('Moving rows', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    vi.mocked(flashBanner).mockClear();
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c', 'd']);
  });

  it('puts the row BEFORE the target', () => {
    moveNamesTo('b', false, ['d']);
    expect(folge()).toEqual(['a', 'd', 'b', 'c']);
  });

  it('and AFTER the target', () => {
    moveNamesTo('b', true, ['d']);
    expect(folge()).toEqual(['a', 'b', 'd', 'c']);
  });

  it('REMOVES it from the old position — move, not copy', () => {
    moveNamesTo('d', true, ['a']);
    expect(folge()).toEqual(['b', 'c', 'd', 'a']);
  });

  it('several rows keep their order among each other', () => {
    moveNamesTo('a', false, ['c', 'd']);
    expect(folge()).toEqual(['c', 'd', 'a', 'b']);
  });

  it('dropping onto itself changes nothing and does not fetch', () => {
    const n = posted.filter((p) => p.type === 'fetchViewRows').length;
    moveNamesTo('b', false, ['b']);
    expect(posted.filter((p) => p.type === 'fetchViewRows')).toHaveLength(n);
  });

  it('an incomplete window is REJECTED', () => {
    // The manual order would have to name the whole set. Making one out of a window
    // would mean silently deleting the rest — the same
    // wall as with inserting.
    antworte(['a', 'b'], true);
    moveNamesTo('a', true, ['b']);
    expect(vi.mocked(flashBanner)).toHaveBeenCalled();
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });

  it('an unknown target changes nothing', () => {
    moveNamesTo('gibtsnicht', false, ['a']);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });
});

// ---------------------------------------------------------------------------

import { initViewDrag, _resetViewDragForTest } from '../webviewClient/dimensionBrowser/viewDrag';
import { toggleMark, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';
import { moveNamesTo } from '../webviewClient/dimensionBrowser/viewOrder';
import { MOVE_CAP } from '../webviewClient/dimensionBrowser/viewOrder';

type H = Record<string, (e: unknown) => void>;

/** A table body with four rows, each 20px high. */
function bauKoerper(): { h: H; ev: (idx: number, unten: boolean) => unknown } {
  const h: H = {};
  const body = {
    addEventListener(t: string, fn: (e: unknown) => void) { h[t] = fn; },
    // The insertion line clears via `querySelectorAll` — here there are no
    // rows to clear, but the method has to be there.
    querySelectorAll: () => [] as unknown[],
  };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => (id === 'table-body' ? body : null),
  };
  const ev = (idx: number, unten: boolean) => ({
    preventDefault: () => {},
    clientY: idx * 20 + (unten ? 15 : 5),
    dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {} },
    target: {
      closest: () => ({
        getAttribute: () => String(idx),
        getBoundingClientRect: () => ({ top: idx * 20, height: 20 }),
        classList: { add: () => {}, remove: () => {} },
      }),
    },
  });
  return { h, ev };
}

describe('The grip', () => {
  const NAMEN = ['a', 'b', 'c', 'd'];
  let bewegt: [string, boolean, readonly string[]][];
  let h: H;
  let ev: (idx: number, unten: boolean) => unknown;

  beforeEach(() => {
    bewegt = [];
    _resetViewDragForTest();
    _resetMarksForTest();
    ({ h, ev } = bauKoerper());
    initViewDrag({
      nameAt: (i) => NAMEN[i] ?? null,
      moveNamesTo: (z, d, n) => { bewegt.push([z, d, n]); },
    });
  });

  it('upper half means BEFORE, lower half AFTER', () => {
    h.dragstart!(ev(3, false));
    h.drop!(ev(1, false));
    expect(bewegt).toEqual([['b', false, ['d']]]);

    h.dragstart!(ev(3, false));
    h.drop!(ev(1, true));
    expect(bewegt[1]).toEqual(['b', true, ['d']]);
  });

  it('a mark that contains the dragged row comes along', () => {
    // Whoever marks six and drags one of them means the six — the same rule
    // as "only this element".
    toggleMark('a');
    toggleMark('c');
    h.dragstart!(ev(0, false));
    h.drop!(ev(3, true));
    expect(bewegt).toEqual([['d', true, ['a', 'c']]]);
  });

  it('an UNmarked row is dragged alone, despite a mark elsewhere', () => {
    toggleMark('a');
    toggleMark('c');
    h.dragstart!(ev(1, false));
    h.drop!(ev(3, true));
    expect(bewegt).toEqual([['d', true, ['b']]]);
  });

  it('no drop without a grip', () => {
    h.drop!(ev(1, false));
    expect(bewegt).toEqual([]);
  });

  it('a cancel leaves nothing behind', () => {
    // Otherwise the next pointer over the table would behave like a target.
    h.dragstart!(ev(0, false));
    h.dragend!({});
    h.drop!(ev(1, false));
    expect(bewegt).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('The insertion line', () => {
  const NAMEN = ['a', 'b', 'c', 'd'];
  let h: H;
  let ev: (idx: number, unten: boolean) => unknown;
  let zeilen: { classList: { add: (c: string) => void; remove: (c: string) => void };
    _klassen: Set<string> }[];

  beforeEach(() => {
    _resetViewDragForTest();
    _resetMarksForTest();
    zeilen = NAMEN.map(() => {
      const k = new Set<string>();
      return { _klassen: k, classList: { add: (c: string) => k.add(c), remove: (c: string) => k.delete(c) } };
    });
    const hh: H = {};
    const body = {
      addEventListener(t: string, fn: (e: unknown) => void) { hh[t] = fn; },
      querySelectorAll: () => zeilen,
    };
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (id === 'table-body' ? body : null),
    };
    h = hh;
    ev = (idx: number, unten: boolean) => ({
      preventDefault: () => {},
      clientY: idx * 20 + (unten ? 15 : 5),
      dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {} },
      target: {
        closest: () => Object.assign(zeilen[idx]!, {
          getAttribute: () => String(idx),
          getBoundingClientRect: () => ({ top: idx * 20, height: 20 }),
        }),
      },
    });
    initViewDrag({ nameAt: (i) => NAMEN[i] ?? null, moveNamesTo: () => {} });
  });

  it('marks the target row at the TOP when inserting before it', () => {
    h.dragstart!(ev(3, false));
    h.dragover!(ev(1, false));
    expect([...zeilen[1]!._klassen]).toEqual(['vw-drop-above']);
  });

  it('and at the BOTTOM when after it', () => {
    h.dragstart!(ev(3, false));
    h.dragover!(ev(1, true));
    expect([...zeilen[1]!._klassen]).toEqual(['vw-drop-below']);
  });

  it('only ONE row carries it at any time', () => {
    // Otherwise the lines would stay behind while dragging across the list.
    h.dragstart!(ev(3, false));
    h.dragover!(ev(0, false));
    h.dragover!(ev(2, true));
    expect([...zeilen[0]!._klassen]).toEqual([]);
    expect([...zeilen[2]!._klassen]).toEqual(['vw-drop-below']);
  });

  it('the drop clears it away', () => {
    h.dragstart!(ev(3, false));
    h.dragover!(ev(1, false));
    h.drop!(ev(1, false));
    expect([...zeilen[1]!._klassen]).toEqual([]);
  });

  it('a cancel likewise', () => {
    h.dragstart!(ev(3, false));
    h.dragover!(ev(1, false));
    h.dragend!({});
    expect([...zeilen[1]!._klassen]).toEqual([]);
  });
});

/**
 * The cap.
 *
 * Moving writes a MANUAL ORDER, and that is an enumerated
 * expression — every name individually. Measured live (11.8, 2026-08-24): about 65 bytes
 * and 43 us per element, linear and without a kink. 20,000 rows are 1.3 MB and
 * 566 ms, and the same expression is re-evaluated on every subsequent operation.
 *
 * The cap is therefore a limit of what is reasonable, not a technical one — and it
 * is a DIFFERENT reason than "the window is incomplete". With 50,000
 * fully loaded rows the old message would simply be wrong, which is why
 * each reason carries its own.
 */
describe('Cap for moving', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    vi.mocked(flashBanner).mockClear();
    startView('aa', 'aa', post);
  });

  /** N names, fully loaded (`hasMore = false`). */
  function geladen(n: number): string[] {
    const namen = Array.from({ length: n }, (_, i) => `e${i}`);
    antworte(namen);
    return namen;
  }

  it('still allows moving exactly at the cap', () => {
    const namen = geladen(MOVE_CAP);
    moveNamesTo('e0', false, ['e1']);
    expect(vi.mocked(flashBanner)).not.toHaveBeenCalled();
    expect(currentMdx()).toContain('e1');
    expect(namen.length).toBe(MOVE_CAP);
  });

  it('refuses one row above it — and states the REASON', () => {
    geladen(MOVE_CAP + 1);
    const vorher = currentMdx();
    moveNamesTo('e0', false, ['e1']);
    expect(vi.mocked(flashBanner)).toHaveBeenCalledTimes(1);
    // Not the incompleteness message: the set IS fully loaded.
    expect(currentMdx()).toBe(vorher);
  });

  it('caps inserting the same way — it is the same thing with a different grip', () => {

    geladen(MOVE_CAP + 1);
    const vorher = currentMdx();
    insertNamesAt('e0', false, ['zzz']);
    expect(vi.mocked(flashBanner)).toHaveBeenCalledTimes(1);
    expect(currentMdx()).toBe(vorher);
  });
});
