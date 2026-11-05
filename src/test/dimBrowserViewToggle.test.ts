import { describe, it, expect, beforeEach, vi } from 'vitest';

// Since 2026-08-22 the messages come from the bundle; the map stands BEFORE
// the imports because `viewPath` fetches it while the module loads.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    vwCollapseNoEffect: 'NICHTS ENTFERNT: {0}',
    loaded: '{0} von {1}',
  };
});

import {
  startView, onViewRows, setBase, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { _resetViewDragForTest } from '../webviewClient/dimensionBrowser/viewDrag';
import { toggleAt } from '../webviewClient/dimensionBrowser/viewActions';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

const zeile = (name: string, ancestors: string[] = [], drilled = false) => ({
  name, caption: name, type: drilled ? 'C' : 'N', level: drilled ? 1 : 0,
  parent: ancestors.length ? ancestors[ancestors.length - 1] : null,
  // Only the names count for deriving the depth — type/level per ancestor are
  // inconsequential filler values here (real values only with `chain: 'name+element'`).
  ancestors: ancestors.map((n) => ({ name: n, type: 'N' as const, level: 0 })),
  drilled,
});

interface FakeEl {
  innerHTML: string;
  textContent: string;
  style: Record<string, string>;
  /**
   * The counter and the hierarchize button touch `classList`/`setAttribute`.
   * A double without both made `paintCounter` fail with a `TypeError` —
   * the double was too thin, not the code too broad.
   */
  classList: { contains: (c: string) => boolean; toggle: (c: string, an?: boolean) => void };
  attrs: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, h: (e: unknown) => void) => void;
}

let posted: { type?: string; mdx?: string; requestId?: number; chain?: string }[] = [];
/**
 * Task 3: since the counter, `fetchRows()` posts TWO messages per state change
 * (`fetchViewRows` + `fetchViewCount`). These tests check only the row
 * behaviour — the filter keeps only `fetchViewRows`, so that the existing
 * index expectations ("the second/third posting") stay correct.
 */
const rowPosted = () => posted.filter((p) => p.type === 'fetchViewRows');
/**
 * One handler slot per ID instead of a single `handler` variable.
 *
 * Finding from the review of 2026-08-22: `startView` now binds TWO
 * containers (`#table-body` for `bindClick`, `#vw-trail` for
 * `bindTrailClick`). A single variable that EVERY binder overwrites then
 * secretly checked "which binder ran last in `startView`" instead of
 * "what does a click on the row do" — and broke on every reordering of the
 * two `binde*Klick` calls, even though both hang on different real
 * DOM elements. The map names the element it clicks.
 */
const handlers: Record<string, (e: unknown) => void> = {};
/**
 * Elements cached per ID — the way a real DOM delivers them, always returning
 * the same object for the same ID. Without the cache every
 * `getElementById` call created a fresh object, and a state check
 * (e.g. `#vw-trail`'s `style.display` before/after a response) would never see
 * the mutation that the production code performs on the "right" object.
 */
let elements: Record<string, FakeEl> = {};

function fakeElement(id: string): FakeEl {
  const klassen = new Set<string>();
  const attrs: Record<string, string> = {};
  return {
    innerHTML: '',
    textContent: '',
    classList: {
      contains: (c) => klassen.has(c),
      toggle: (c, an) => { if (an ?? !klassen.has(c)) { klassen.add(c); } else { klassen.delete(c); } },
    },
    attrs,
    setAttribute: (name, value) => { attrs[name] = value; },
    // `#vw-trail` starts in the real markup with `display:none` (Task 5) — the
    // reveal test below needs exactly this starting value, otherwise its
    // check has no effect (review 2026-08-22).
    style: id === 'vw-trail' ? { display: 'none' } : {},
    // The event TYPE goes into the key too: `initViewDrag` attaches four drag
    // listeners to the same element. Without the type the last of them
    // overwrote the click listener, and which one remained in the end was
    // decided by the test order — `initViewDrag` binds only ONCE (`clickBound`).
    addEventListener: (type, h) => { handlers[`${id}:${type}`] = h; },
  };
}

beforeEach(() => {
  posted = [];
  elements = {};
  for (const k of Object.keys(handlers)) { delete handlers[k]; }
  _resetViewPathForTest();
  // Otherwise only the first test of the file binds the drag listeners.
  _resetViewDragForTest();
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => {
      if (!elements[id]) { elements[id] = fakeElement(id); }
      return elements[id];
    },
  };
});

/** Simulate a click event on the row at position `idx` (via `data-idx`). */
function klickAuf(idx: string): void {
  const tr = { getAttribute: (a: string) => (a === 'data-idx' ? idx : null) };
  const target = {
    classList: { contains: (c: string) => c === 'vw-twisty' },
    closest: (s: string) => (s === 'tr' ? tr : null),
  };
  handlers['table-body:click']({ target });
}

describe('The silent collapse click', () => {
  /**
   * `DRILLUPMEMBER` is positional: it only removes a block that stands DIRECTLY
   * behind its parent. Measured live (2026-08-22): on `aa`, `a` and `b` were
   * created before their consolidation `sum`, so there is no block behind `sum`,
   * and the click does nothing. Before: no message, and the intent stayed
   * in the stack.
   */
  it('withdraws the intent and reports it when nothing has changed', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    const antwort = () => ({
      type: 'viewRows', requestId: rowPosted()[rowPosted().length - 1].requestId!,
      ok: true, hasMore: false,
      rows: [zeile('a', []), zeile('sum', [], true)],
    });
    onViewRows(antwort() as never);
    toggleAt('sum');
    onViewRows(antwort() as never);

    expect(elements['error-banner'].textContent).toBe('NICHTS ENTFERNT: sum');
    // The next click must again be a COLLAPSE — if the intent were still
    // in the stack, it would be an expand and the display would stay
    // inexplicably silent for the user.
    toggleAt('sum');
    expect(rowPosted()[rowPosted().length - 1].mdx).toContain('DRILLUPMEMBER');
  });

  it('reports NOTHING when something still stands behind the window', () => {
    // Then "nothing happened" cannot be distinguished from "the block lies outside
    // the window" — a message would be a claim.
    startView('aa', 'aa', (m) => posted.push(m as never));
    const antwort = () => ({
      type: 'viewRows', requestId: rowPosted()[rowPosted().length - 1].requestId!,
      ok: true, hasMore: true,
      rows: [zeile('a', []), zeile('sum', [], true)],
    });
    onViewRows(antwort() as never);
    toggleAt('sum');
    onViewRows(antwort() as never);
    expect(elements['error-banner'].textContent).toBe('');
  });

  it('reports NOTHING when the collapse took effect', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    onViewRows({
      type: 'viewRows', requestId: rowPosted()[0].requestId!, ok: true, hasMore: false,
      rows: [zeile('d', [], true), zeile('c', ['d'])],
    } as never);
    toggleAt('d');
    onViewRows({
      type: 'viewRows', requestId: rowPosted()[1].requestId!, ok: true, hasMore: false,
      rows: [zeile('d', [], true)],
    } as never);
    expect(elements['error-banner'].textContent).toBe('');
  });
});

describe('Collapse click', () => {
  it('turns a click into a DRILLUPMEMBER intent', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    onViewRows({
      type: 'viewRows', requestId: posted[0].requestId!, ok: true,
      rows: [zeile('d', [], true), zeile('c', ['d'])], hasMore: false,
    } as never);
    toggleAt('d');
    expect(rowPosted()).toHaveLength(2);
    expect(rowPosted()[1].mdx).toContain('DRILLUPMEMBER');
    expect(rowPosted()[1].mdx).toContain('Name = "d"');
    // The intent names the MEMBER, not the occurrence — DRILL* hits
    // every occurrence anyway (measured live).
  });

  it('removes the intent again on the second click', () => {
    // The direction comes from the collapse state OF THE ROW: first `d` stands open
    // (tree base), the click collapses it; afterwards the response reports `d` as closed,
    // and the same click removes the intent again. No counterpart
    // needed — on the tree base everything is already expanded anyway.
    startView('aa', 'aa', (m) => posted.push(m as never));
    toggleAt('d', true);
    expect(rowPosted()[1].mdx).toContain('DRILLUPMEMBER');
    toggleAt('d', false);
    expect(rowPosted()[2].mdx).not.toContain('DRILLUPMEMBER');
  });

  it('on the set, the same triangle expands instead of collapsing', () => {
    // `TM1SUBSETALL` reports every element as collapsed — there the
    // triangle is a DRILLDOWNMEMBER. Measured live 2026-08-22: 8 rows
    // become 9, `a` then stands behind `sum`.
    startView('aa', 'aa', (m) => posted.push(m as never));
    setBase('set');
    toggleAt('sum', false);
    const mdx = String(rowPosted()[rowPosted().length - 1].mdx);
    expect(mdx).toContain('DRILLDOWNMEMBER');
    expect(mdx).toContain('TM1SUBSETALL');
    expect(mdx).not.toContain('DRILLUPMEMBER');
    // And the counter-click on the then open occurrence removes it.
    toggleAt('sum', true);
    expect(String(rowPosted()[rowPosted().length - 1].mdx)).not.toContain('DRILLDOWNMEMBER');
  });

  it('a click on the base that is already active still resets', () => {
    // flameY3T1, 2026-08-22: "when I click tree or all, everything should always
    // be reset." Before, the click on the active base was a
    // no-op, and the stack could only be emptied via the detour of the other
    // base.
    startView('aa', 'aa', (m) => posted.push(m as never));
    toggleAt('d', true);
    expect(rowPosted()[1].mdx).toContain('DRILLUPMEMBER');
    setBase('tree');
    const mdx = String(rowPosted()[rowPosted().length - 1].mdx);
    expect(mdx).not.toContain('DRILLUPMEMBER');
    expect(mdx).toContain('[aa].[aa].Members');
  });

  it('requests again after every click', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    toggleAt('d');
    expect(rowPosted()[1].requestId).not.toBe(rowPosted()[0].requestId);
  });

  it('a real click on the triangle sets the intent for the member of the row', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    onViewRows({
      type: 'viewRows', requestId: posted[0].requestId!, ok: true,
      rows: [zeile('sum', [], true), zeile('d', ['sum'], true)], hasMore: false,
    } as never);
    expect(handlers['table-body:click']).toBeDefined();
    klickAuf('1'); // position 1 = 'd'
    expect(rowPosted()).toHaveLength(2);
    expect(rowPosted()[1].mdx).toContain('DRILLUPMEMBER');
    expect(rowPosted()[1].mdx).toContain('Name = "d"');
  });

  it('a click on a position without a row warns and sets nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startView('aa', 'aa', (m) => posted.push(m as never));
    onViewRows({
      type: 'viewRows', requestId: posted[0].requestId!, ok: true,
      rows: [zeile('sum', [], true)], hasMore: false,
    } as never);
    expect(handlers['table-body:click']).toBeDefined();
    const vorher = posted.length;
    klickAuf('99'); // there is no row at this position
    expect(posted).toHaveLength(vorher);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('posted fetchViewRows carries the chain projection', () => {
  // Regression guard (final review 2026-08-22): `poster` is typed as
  // `(m: unknown) => void` — a deleted `chain` line in
  // `fetchRows()` does not show up at compile time, and without this assertion
  // no test would ever notice it. Every ancestor would then arrive with the
  // fallback `type:'N', level:0`, and type/level filters would silently indent
  // rows wrongly.
  it('requests the full projection for a type layer', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    applyFilter({ kind: 'type', types: ['C'] });
    expect(rowPosted()[1].chain).toEqual({ kind: 'name+element' });
  });

  it('requests the lean projection for a pattern layer alone', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    applyFilter({ kind: 'pattern', pattern: 'a*' });
    expect(rowPosted()[1].chain).toEqual({ kind: 'name' });
  });
});

describe('Trail reveal', () => {
  it('stays hidden before the first response and becomes visible afterwards', () => {
    // Regression guard (review 2026-08-22): in an earlier plan of this
    // rework the content stood correctly in the DOM while its container
    // stayed invisible — every test was green because none checked more than
    // `innerHTML`. `#vw-trail` starts with `display:none` in the markup
    // (dimensionBrowserBody.ts) and is only revealed by `onViewRows`.
    startView('aa', 'aa', (m) => posted.push(m as never));
    const trail = elements['vw-trail'];
    expect(trail).toBeDefined();
    expect(trail.style.display).toBe('none');
    onViewRows({
      type: 'viewRows', requestId: posted[0].requestId!, ok: true,
      rows: [zeile('d')], hasMore: false,
    } as never);
    expect(trail.style.display).toBe('flex');
  });
});
