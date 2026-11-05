import { describe, it, expect, beforeEach, vi } from 'vitest';

// The map comes BEFORE the imports, because `viewPath` fetches it when the module loads.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    loaded: '{0} von {1}',
  };
});
import { viewRowsHtml } from '../webviewClient/dimensionBrowser/viewRender';
import type { DisplayRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';

function zeile(name: string, type: 'N' | 'C' | 'S' = 'N'): DisplayRow {
  return {
    name, caption: name, type, level: 0, parent: null, drilled: false,
    ancestors: [], depth: 0, key: name,
  };
}

describe('viewRowsHtml counts data-idx from an offset', () => {
  it('starts at 0 without an offset', () => {
    const html = viewRowsHtml([zeile('a'), zeile('b')]);
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('data-idx="1"');
  });

  it('with an offset starts where the previous window ended', () => {
    // The core of appending: the appended rows must carry the same
    // positions they have in the `rows` array — otherwise the click path
    // looks up the wrong row.
    const html = viewRowsHtml([zeile('c'), zeile('d')], 5000);
    expect(html).toContain('data-idx="5000"');
    expect(html).toContain('data-idx="5001"');
    expect(html).not.toContain('data-idx="0"');
  });
});

import {
  startView, onViewRows, _resetViewPathForTest, currentRows, drawView,
} from '../webviewClient/dimensionBrowser/viewPath';
import { WINDOW } from '../webviewClient/dimensionBrowser/viewFetch';
import { setSort } from '../webviewClient/dimensionBrowser/viewActions';

/** An element stub that records classes and children. */
function fakeEl(id: string) {
  return {
    id, innerHTML: '', textContent: '', style: { display: '' } as Record<string, string>,
    // The counter and the toggles touch `classList`/`setAttribute` — a double
    // without both fails with a TypeError instead of checking the behaviour.
    classList: { contains: () => false, toggle: () => {}, add: () => {}, remove: () => {} },
    setAttribute() {},
    scrollTop: 0, clientHeight: 100, scrollHeight: 100,
    _handler: null as null | ((e: unknown) => void),
    addEventListener(_t: string, h: (e: unknown) => void) { this._handler = h; },
    insertAdjacentHTML(_pos: string, html: string) { this.innerHTML += html; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
}

describe('loading more appends to the rows array, but drawing still starts afresh', () => {
  let els: Record<string, ReturnType<typeof fakeEl>>;
  let posts: Array<Record<string, unknown>>;
  /**
   * Task 3: since the counter was added, `fetchRows(false)` ADDITIONALLY posts
   * `fetchViewCount` — when appending (`fetchRows(true)`) it stays with
   * `fetchViewRows` alone. These tests check only the row/paging behaviour.
   */
  const rowPosts = () => posts.filter((p) => p.type === 'fetchViewRows');

  beforeEach(() => {
    _resetViewPathForTest();
    els = {};
    posts = [];
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        if (!els[id]) { els[id] = fakeEl(id); }
        return els[id];
      },
    };
  });

  function antwort(requestId: number, anzahl: number, hasMore: boolean, praefix: string) {
    const rows = Array.from({ length: anzahl }, (_, i) => ({
      name: `${praefix}${i}`, caption: `${praefix}${i}`, type: 'N' as const,
      level: 0, parent: null, drilled: false, ancestors: [],
    }));
    onViewRows({
      type: 'viewRows', requestId, dimName: 'd', hierName: 'h',
      ok: true, rows, hasMore,
    } as never);
  }

  it('the first window asks with skip 0 and draws afresh', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    expect(rowPosts()).toHaveLength(1);
    expect(posts[0].top).toBe(WINDOW);
    expect(String(posts[0].mdx)).toContain(', 0, ');
    antwort(Number(posts[0].requestId), 3, true, 'a');
    expect(currentRows()).toHaveLength(3);
    expect(els['table-body'].innerHTML).toContain('data-idx="0"');
  });

  it('the second window asks from the number of rows already present and appends', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    antwort(Number(posts[0].requestId), 3, true, 'a');

    // Push the scroll position to the end and fire the bound handler.
    const c = els['table-container'];
    c.scrollTop = 100; c.clientHeight = 100; c.scrollHeight = 150;
    c._handler!({});

    expect(rowPosts()).toHaveLength(2);
    expect(String(rowPosts()[1].mdx)).toContain(', 3, ');
    antwort(Number(rowPosts()[1].requestId), 2, false, 'b');

    expect(currentRows()).toHaveLength(5);
    // Only the `rows` array is appended to (Task 4: `drawWindow()`
    // rewrites `innerHTML` completely on EVERY occasion, also when
    // appending) — so this does NOT check that the old text is a prefix
    // of the new one, but that both rows from window 2 are in the freshly
    // drawn slice.
    expect(els['table-body'].innerHTML).toContain('data-idx="3"');
    expect(els['table-body'].innerHTML).toContain('data-idx="4"');
  });

  // Since M7 (2026-08-25) the path appends with `push` instead of copying the
  // whole set via `concat` on every window. Copying preserved the order by
  // itself; appending must KEEP doing so, across several windows. Hence the
  // full sequence here, not just the length.
  it('three windows line up one after another without gaps and in order', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    antwort(Number(posts[0].requestId), 3, true, 'a');

    const c = els['table-container'];
    const nachladen = () => {
      c.scrollTop = 100; c.clientHeight = 100; c.scrollHeight = 150;
      c._handler!({});
    };

    nachladen();
    antwort(Number(rowPosts()[1].requestId), 2, true, 'b');
    nachladen();
    antwort(Number(rowPosts()[2].requestId), 2, false, 'c');

    expect(currentRows().map((r) => r.name))
      .toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'c0', 'c1']);
    // And the third window asked from the number of rows already present — had
    // something been lost while appending, a smaller value would be here.
    expect(String(rowPosts()[2].mdx)).toContain(', 5, ');
  });

  it('at the bottom end the drawer itself also triggers further loading, no matter how many rows are already present', () => {
    // There used to be a cap (`CAP`) here, which `drawWindow()` enforced
    // itself — this test recorded exactly the OPPOSITE. Since Task 6 there
    // is no cap any more: the drawing path keeps loading on EVERY occasion
    // (here: `drawView()`, standing in for marking, counting, Esc, Ctrl+A)
    // as long as the server has more — even at row counts far beyond the
    // former cap (20,000).
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    antwort(Number(posts[0].requestId), 25000, true, 'a');
    const c = els['table-container'];
    // View at the very bottom, without involving the scroll listener.
    c.scrollTop = 1e9; c.clientHeight = 100; c.scrollHeight = 100;
    expect(rowPosts()).toHaveLength(1);
    drawView();
    expect(rowPosts()).toHaveLength(2);
  });

  it('without hasMore nothing more is loaded at all', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    antwort(Number(posts[0].requestId), 3, false, 'a');
    const c = els['table-container'];
    c.scrollTop = 100; c.clientHeight = 100; c.scrollHeight = 150;
    c._handler!({});
    expect(rowPosts()).toHaveLength(1);
  });

  it('a fresh answer writes the trail and MDX bar, even when the drawer itself loads more (fix round 1, finding 2)', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    const c = els['table-container'];
    // The view is already at the very bottom BEFORE the answer: the first drawing
    // pass inside `onViewRows` therefore triggers a `fetchRows(true)` itself and
    // sets `run.appending = true` in the process — even though THIS answer was fresh.
    c.scrollTop = 1e9; c.clientHeight = 100; c.scrollHeight = 100;
    antwort(Number(posts[0].requestId), 5, true, 'a');
    // The drawer really did load more.
    expect(rowPosts()).toHaveLength(2);
    // The trail and MDX bar must still be shown: they depend on the
    // FRESHNESS of the answer, not on what the drawer triggered AFTER its
    // arrival.
    expect(els['vw-trail'].style.display).toBe('flex');
    expect(els['subset-mdx-bar'].style.display).toBe('flex');
  });

  it('draws the first slice only AFTER the phase is set to ready (fix round 2, finding 1)', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    // Create `table-container` deliberately BEFORE the answer: the test then
    // accesses the same object that `setViewPhase('ready')` switches.
    const tableContainer = els['table-container'] ?? (els['table-container'] = fakeEl('table-container'));
    const tableBody = els['table-body'] ?? (els['table-body'] = fakeEl('table-body'));
    let displayBeimErstenZeichnen: string | null = null;
    let innerHTMLWert = '';
    // `innerHTML` switched to a setter that records, BEFORE the actual write,
    // what state `table-container` is in at that moment — the drawer must no
    // longer find the pane invisible here.
    Object.defineProperty(tableBody, 'innerHTML', {
      configurable: true,
      get: () => innerHTMLWert,
      set: (v: string) => {
        if (displayBeimErstenZeichnen === null) {
          displayBeimErstenZeichnen = tableContainer.style.display;
        }
        innerHTMLWert = v;
      },
    });
    antwort(Number(posts[0].requestId), 3, false, 'a');
    expect(displayBeimErstenZeichnen).toBe('block');
  });

  it('a new set of rows after a deep scroll position resets the container to 0 (fix round 2, finding 2)', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    antwort(Number(posts[0].requestId), 100, false, 'a');
    const c = els['table-container'];
    c.clientHeight = 100;
    // Deep scroll position, as at row 100,000 in a 5000-row window
    // (scrollTop ≈ 2.2 million) — unreachable before virtualisation, because
    // `scrollTop` never got that large with rows capped at 20,000.
    c.scrollTop = 2_200_000;
    // Sorting is a state change, not an append: `fetchRows()` sets
    // `run.appending = false`, the same condition as when filtering.
    setSort('asc');
    expect(rowPosts()).toHaveLength(2);
    antwort(Number(rowPosts()[1].requestId), 50, false, 'b');
    expect(c.scrollTop).toBe(0);
  });
});

describe('the drawer paints a slice, not the list', () => {
  let els: Record<string, ReturnType<typeof fakeEl>>;
  let posts: Array<{ type: string; skip?: number }>;

  /** As in the rest of the file: the requestId comes from the last fetchViewRows. */
  function letzteId(): number {
    const p = posts.filter((x) => x.type === 'fetchViewRows');
    return (p[p.length - 1] as unknown as { requestId: number }).requestId;
  }

  beforeEach(() => {
    _resetViewPathForTest();
    els = {};
    posts = [];
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        if (!els[id]) {
          els[id] = fakeEl(id);
          // 600px viewport → 28 visible rows at 22px, plus 12 buffer rows.
          if (id === 'table-container') { els[id].clientHeight = 600; }
        }
        return els[id];
      },
    };
  });

  /** N answer rows in the shape the host delivers (`ViewAnswerRow`). */
  function antwortMit(anzahl: number, hasMore: boolean): void {
    const rows = Array.from({ length: anzahl }, (_, i) => ({
      name: `e${i}`, caption: `e${i}`, type: 'N' as const,
      level: 0, parent: null, drilled: false, ancestors: [],
    }));
    onViewRows({
      type: 'viewRows', requestId: letzteId(), dimName: 'd', hierName: 'h',
      ok: true, rows, hasMore,
    } as never);
  }

  it('with 100,000 rows writes only the slice into the body', () => {
    startView('dim', 'hier', (m) => posts.push(m as { type: string }));
    antwortMit(100000, false);
    const html = els['table-body'].innerHTML;
    const zeilen = (html.match(/class="vw-row/g) ?? []).length;
    // 40 rows (28 visible + 12 buffer rows below), not 100,000.
    expect(zeilen).toBeLessThan(100);
    expect(zeilen).toBeGreaterThan(20);
  });

  it('sets a bottom spacer for everything that is not drawn', () => {
    startView('dim', 'hier', (m) => posts.push(m as { type: string }));
    antwortMit(100000, false);
    expect(els['table-body'].innerHTML).toContain('class="vspacer"');
  });

  it('keeps data-idx absolute — the click path uses it to look up the rows array', () => {
    startView('dim', 'hier', (m) => posts.push(m as { type: string }));
    antwortMit(100000, false);
    els['table-container'].scrollTop = 22000;
    drawView();
    const html = els['table-body'].innerHTML;
    expect(html).toContain('data-idx="1000"');
    expect(html).not.toContain('data-idx="0"');
  });

  it('paints no spacer at all for short lists', () => {
    startView('dim', 'hier', (m) => posts.push(m as { type: string }));
    antwortMit(10, false);
    expect(els['table-body'].innerHTML).not.toContain('vspacer');
  });

  describe('scrolling draws and loads more', () => {
    it('draws a different slice when scrolling', () => {
      startView('dim', 'hier', (m) => posts.push(m as { type: string }));
      antwortMit(100000, false);
      const vorher = els['table-body'].innerHTML;
      els['table-container'].scrollTop = 44000;
      els['table-container']._handler?.({});
      expect(els['table-body'].innerHTML).not.toBe(vorher);
      expect(els['table-body'].innerHTML).toContain('data-idx="2000"');
    });

    it('throttles to one pass per frame', () => {
      // Scar 2: `scroll` fires several times per frame, and each pass replaces
      // the whole tbody. Unthrottled, every rebuild throws away the row under
      // the pointer — report 2026-08-04 "folgt langsam aufwaerts" (slowly
      // follows upwards).
      //
      // Cleaning up is mandatory, not cosmetic: `requestAnimationFrame` lands
      // on `globalThis`, which the test file shares with ALL other `it`s — a
      // stub left lying around that only collects frames instead of running
      // them would starve every later scroll test in the same run.
      const frames: Array<() => void> = [];
      (globalThis as Record<string, unknown>).requestAnimationFrame =
        (cb: () => void) => { frames.push(cb); return frames.length; };
      try {
        startView('dim', 'hier', (m) => posts.push(m as { type: string }));
        antwortMit(100000, false);
        els['table-container']._handler?.({});
        els['table-container']._handler?.({});
        els['table-container']._handler?.({});
        expect(frames.length).toBe(1);
      } finally {
        delete (globalThis as Record<string, unknown>).requestAnimationFrame;
      }
    });

    it('loads more when the slice reaches the end of the loaded rows', () => {
      startView('dim', 'hier', (m) => posts.push(m as { type: string }));
      antwortMit(5000, true);
      const vorher = posts.filter((p) => p.type === 'fetchViewRows').length;
      els['table-container'].scrollTop = 5000 * 22 - 600;
      els['table-container']._handler?.({});
      expect(posts.filter((p) => p.type === 'fetchViewRows').length).toBeGreaterThan(vorher);
    });

    it('does NOT load more while a request is running', () => {
      startView('dim', 'hier', (m) => posts.push(m as { type: string }));
      antwortMit(5000, true);
      els['table-container'].scrollTop = 5000 * 22 - 600;
      els['table-container']._handler?.({});
      const nachErstem = posts.filter((p) => p.type === 'fetchViewRows').length;
      els['table-container']._handler?.({});
      expect(posts.filter((p) => p.type === 'fetchViewRows').length).toBe(nachErstem);
    });
  });

  it('no longer reports a cap — there is none', () => {

    startView('dim', 'hier', (m) => posts.push(m as { type: string }));
    antwortMit(25000, true);
    expect(els['error-banner'].style.display).not.toBe('block');
  });
});
