import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, currentMdx, onViewRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import {
  parentsFromEdges, showParentPicks, pickParent, _resetParentPickForTest,
} from '../webviewClient/dimensionBrowser/parentPick';

let posted: { type: string; requestId?: number; element?: string; recursive?: boolean }[] = [];
const post = (m: unknown) => { posted.push(m as never); };

type Stub = { innerHTML: string; className: string; textContent: string;
  dataset: Record<string, string>; children: Stub[];
  appendChild(c: Stub): void; classList: { add(): void; remove(): void } };
function stub(): Stub {
  const o = {
    _html: '', className: '', textContent: '', dataset: {}, children: [] as Stub[],
    appendChild(c: Stub) { o.children.push(c); },
    classList: { add: () => {}, remove: () => {} },
  };
  // In a real DOM, `innerHTML = ''` clears away the children as well. A
  // stub that does not reproduce this would check a clearing that does not exist.
  Object.defineProperty(o, 'innerHTML', {
    get: () => o._html,
    set: (v: string) => { o._html = v; if (!v) { o.children.length = 0; } },
  });
  return o as unknown as Stub;
}

/**
 * "Show parents" is a SUBMENU: it lists the parents of the clicked
 * element and lets you choose a SPECIFIC one (flameY3T1, 2026-08-23). An
 * element can hang under several — but the row itself only knows the
 * occurrence under which it stands. All of them come from the server.
 */
describe('The parent list', () => {
  it('reads the parents from the edges, not from the row', () => {
    // The row carries only ITS occurrence path. `drillAncestors` brings the
    // edges, and all parents stand there.
    expect(parentsFromEdges([
      { ParentName: 'sum', ComponentName: 'a' },
      { ParentName: 'd', ComponentName: 'a' },
      { ParentName: 'd', ComponentName: 'c' },
    ], 'a')).toEqual(['sum', 'd']);
  });

  it('deduplicates and keeps the order of the edges', () => {
    expect(parentsFromEdges([
      { ParentName: 'd', ComponentName: 'a' },
      { ParentName: 'd', ComponentName: 'a' },
      { ParentName: 'sum', ComponentName: 'a' },
    ], 'a')).toEqual(['d', 'sum']);
  });
});

describe('The submenu', () => {
  let host: Stub;
  let item: Stub;

  beforeEach(() => {
    _resetParentPickForTest();
    host = stub();
    item = stub();
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (id === 'ctx-show-parents-sub' ? host
        : id === 'ctx-show-parents' ? item : null),
      createElement: () => stub(),
    };
  });

  it('names each parent as its own entry', () => {
    showParentPicks(['sum', 'd']);
    expect(host.children.map((c) => c.textContent)).toEqual(['sum', 'd']);
    expect(host.children.map((c) => c.dataset.parent)).toEqual(['sum', 'd']);
  });

  it('clears the previous list instead of appending', () => {
    showParentPicks(['sum']);
    showParentPicks(['d']);
    expect(host.innerHTML).toBe('');
    expect(host.children.map((c) => c.textContent)).toEqual(['d']);
  });
});

/**
 * The chosen parent stands ABOVE its occurrence, not at the bottom.
 *
 * Until 2026-08-25 the choice ran via `addNames` → `{kind:'add'}` →
 * `UNION(menge, {p}, ALL)`. `UNION(..., ALL)` appends to the END of the whole set:
 * the parent landed below the last row instead of above its child
 * (click test flameY3T1, 2026-08-25).
 *
 * `TM1ROLLUP` cannot do it — measured live on `aa` (2026-08-25):
 *   TM1ROLLUP(M, {d^a})            -> sum a d c [sum d] a ...   BOTH parents
 *   TM1ROLLUP(M, {d^a}, {sum})     -> HTTP 400/501 syntax error (no 3rd argument)
 *   GENERATE(M, IIF(...), ALL)     -> HTTP 400/501 syntax error
 *   RANK(d^a, M) as position       -> SILENTLY empty, no error
 *   EXCEPT(ROLLUP(...), {sum}, ALL)-> also tears out the real root `sum`
 * The inserted parents come back as BARE `[sum]`/`[d]` (UniqueNames
 * measured) and therefore cannot be distinguished from a real root.
 *
 * What holds is the cut at the position — 6/6 edge cases green live,
 * including k=0, the last row and the second occurrence of the same name.
 */
describe('The chosen parent stands above', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetParentPickForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  /** Set up a view with `n` rows, so that `at` has a meaning. */
  function sicht(n: number): void {
    startView('aa', 'aa', post);
    onViewRows({
      type: 'viewRows', requestId: Number(posted[0].requestId), dimName: 'aa', hierName: 'aa',
      ok: true, hasMore: false,
      rows: Array.from({ length: n }, (_, i) => ({
        name: `e${i}`, caption: `e${i}`, type: 'N', level: 0, parent: null,
        drilled: false, ancestors: [],
      })),
    } as never);
  }

  it('cuts the set open and puts it into the cut', () => {
    sicht(10);
    pickParent('sum', 4);
    expect(currentMdx()).toBe(
      '{UNION({UNION({HEAD({[aa].[aa].Members}, 4)}, {[aa].[aa].[sum]}, ALL)},'
      + ' {SUBSET({[aa].[aa].Members}, 4, 1000000)}, ALL)}',
    );
  });

  it('position 0: no empty HEAD, simply in front', () => {
    // `HEAD(M, 0)` returns the EMPTY set (measured live) — a `UNION` with it
    // would be a detour around nothing.
    sicht(10);
    pickParent('d', 0);
    expect(currentMdx()).toBe('{UNION({[aa].[aa].[d]}, {[aa].[aa].Members}, ALL)}');
  });

  it('does NOT append at the end any more', () => {
    sicht(10);
    pickParent('sum', 4);
    expect(currentMdx()).not.toContain('{UNION({[aa].[aa].Members}, {[aa].[aa].[sum]}, ALL)}');
  });

  it('an empty name does nothing', () => {
    sicht(10);
    pickParent('', 4);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });

  it('a position outside the set does nothing', () => {
    // For `k` beyond the end, the server appends at the end (measured live) —
    // which is exactly the bug being fixed here. Better to do nothing.

    sicht(10);
    pickParent('sum', 99);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
    pickParent('sum', -1);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });
});
