import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, currentMdx, onViewRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

/**
 * Decision by flameY3T1, 2026-08-23: "das angezeigte MDX soll auch das MDX sein,
 * das man sieht, wenn man das MDX-Popup aufruft." (The displayed MDX should also
 * be the MDX you see when you open the MDX popup.)
 *
 * Since Task 3 the new path writes the bar itself; the POPUP kept reading
 * `effectiveMdx()` from the old path (drill > subset expression > list). Both
 * now read the SAME source — otherwise one place shows the truth and the
 * other a state the new path never declared.
 */
describe('one expression, two displays', () => {
  let posted: unknown[] = [];
  const post = (m: unknown) => { posted.push(m); };

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('knows no expression as long as no dimension is open', () => {
    // `null`, not an empty string: the caller should be able to tell whether
    // there is nothing to show or whether the expression WOULD be empty.
    expect(currentMdx()).toBeNull();
  });

  it('names the expression of the stack', () => {
    startView('aa', 'aa', post);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
    applyFilter({ kind: 'type', types: ['C'] });
    expect(currentMdx()).toContain('ELEMENT_TYPE');
  });

  it('INCLUDES the preview — it is part of what you see', () => {
    startView('aa', 'aa', post);
    previewLayer({ kind: 'pattern', pattern: 'bahn*' });
    expect(currentMdx()).toContain('TM1FILTERBYPATTERN');
  });

  it('carries NO window — the expression is the set, not the slice', () => {
    // `fetchMdx` wraps `SUBSET(..., skip, top+1)` around it. Whoever copies the
    // expression or saves it as a subset wants the set, not the
    // scroll position.
    startView('aa', 'aa', post);
    expect(currentMdx()).not.toContain('SUBSET(');
  });
});

describe('the bar shows the same as the popup', () => {
  let posted: { type?: string; requestId?: number }[] = [];
  const post = (m: unknown) => { posted.push(m as never); };

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    const bar = { style: { display: '' }, title: '', innerHTML: '' };
    const textEl = { textContent: '', style: { display: '' }, innerHTML: '' };
    const rest: Record<string, unknown> = {};
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        if (id === 'subset-mdx-bar') { return bar; }
        if (id === 'subset-mdx-text') { return textEl; }
        // Everything else generic: the drawing path touches several elements,
        // and a missing one would make it turn back before the bar.
        if (!rest[id]) {
          rest[id] = {
            style: { display: '' }, title: '', innerHTML: '', textContent: '',
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            setAttribute: () => {}, addEventListener: () => {},
            querySelectorAll: () => [], scrollTop: 0, scrollHeight: 0, clientHeight: 0,
          };
        }
        return rest[id];
      },
    };
    (globalThis as unknown as { __el: unknown }).__el = { bar, textEl };
  });

  it('writes exactly `currentMdx()` into the bar when drawing', () => {
    startView('aa', 'aa', post);
    applyFilter({ kind: 'pattern', pattern: 'bahn*' });
    // Filter by `type`, not by `requestId`: `fetchViewCount` carries one
    // too, and the last one then belongs to the count.
    const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
    onViewRows({
      type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
      ok: true, rows: [], cardinality: 0,
    } as never);
    const els = (globalThis as unknown as { __el: { textEl: { textContent: string } } }).__el;
    expect(els.textEl.textContent).toBe(currentMdx());
  });
});

// ---------------------------------------------------------------------------

import { mdxForPopup } from '../webviewClient/dimensionBrowser/mdxSource';

describe('where the popup takes its expression from', () => {
  beforeEach(() => {
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('from `currentMdx()`, not from a composition state', () => {
    startView('aa', 'aa', () => {});
    applyFilter({ kind: 'pattern', pattern: 'bahn*' });
    expect(mdxForPopup()).toBe(currentMdx());
  });

  it('does NOT silently fall back to a foreign state', () => {
    // Without an open dimension there is nothing to show in the new path.
    // Showing the old state would be exactly the silent fallback: the popup
    // would show an expression the new path never declared.
    expect(mdxForPopup()).toBe('');
  });
});

// ---------------------------------------------------------------------------

import { runEditedMdx } from '../webviewClient/dimensionBrowser/mdxSource';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';
import { previewLayer } from '../webviewClient/dimensionBrowser/viewLayers';

describe('running in the popup', () => {
  beforeEach(() => {
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('makes the expression the base in the new path and reports that it has been taken over', () => {
    // The return value is the promise to the caller: taken over means the
    // old branch must NOT run as well — two paths into the same table body
    // would be a race that the last one wins.

    startView('aa', 'aa', () => {});
    expect(runEditedMdx('{TM1SUBSETALL([aa].[aa])}')).toBe(true);
    expect(currentMdx()).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

});
