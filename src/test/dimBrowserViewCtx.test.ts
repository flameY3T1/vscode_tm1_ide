import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    newViewPathControlUnavailable: 'GEHT HIER NOCH NICHT',
    vwBaseMembers: 'Baum', vwBaseAll: 'Alle', vwBaseRoots: 'Wurzeln',
    vwTrailKept: 'behalten ({0})', vwTrailRemoved: 'entfernt ({0})',
    vwBaseExplicit: 'Auswahl ({0})', loaded: '{0} von {1}',
    ctxOnlyThis: 'Nur dieses Element', ctxOnlyThese: 'Nur diese Elemente{0}',
  };
});

import {
  startView, applyCtxAction, removeMarked, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { toggleMark, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';
import { keepMarked } from '../webviewClient/dimensionBrowser/viewLayers';

interface FakeEl {
  innerHTML: string; textContent: string; style: Record<string, string>;
  klassen: Set<string>;
  classList: { contains(c: string): boolean; toggle(c: string, an?: boolean): void; add(c: string): void; remove(c: string): void };
  setAttribute(n: string, v: string): void;
  addEventListener(t: string, h: (e: unknown) => void): void;
  insertAdjacentHTML(p: string, h: string): void;
  querySelectorAll(sel: string): unknown[];
  offsetWidth: number; offsetHeight: number;
  scrollTop: number; clientHeight: number; scrollHeight: number;
}

let posted: { type?: string; mdx?: string; requestId?: number }[] = [];
let els: Record<string, FakeEl> = {};

function fake(): FakeEl {
  const klassen = new Set<string>();
  return {
    innerHTML: '', textContent: '', style: {}, klassen,
    classList: {
      contains: (c) => klassen.has(c),
      toggle: (c, an) => { if (an ?? !klassen.has(c)) { klassen.add(c); } else { klassen.delete(c); } },
      add: (c) => { klassen.add(c); }, remove: (c) => { klassen.delete(c); },
    },
    setAttribute: () => {}, addEventListener: () => {},
    insertAdjacentHTML: () => {}, querySelectorAll: () => [],
    offsetWidth: 100, offsetHeight: 100,
    scrollTop: 0, clientHeight: 100, scrollHeight: 100,
  };
}

const rowPosts = () => posted.filter((p) => p.type === 'fetchViewRows');
const letzteMdx = () => String(rowPosts()[rowPosts().length - 1].mdx);

beforeEach(() => {
  posted = []; els = {};
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => (els[id] ??= fake()),
    addEventListener: () => {},
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 800, innerHeight: 600 };
  _resetViewPathForTest();
  _resetMarksForTest();
  startView('aa', 'aa', (m) => posted.push(m as never));
});

/**
 * `applyCtxAction` only carries out what `ctxIntents.ts` has decided. The
 * test checks the EFFECT: which expression goes out, what is in the banner.
 */
describe('context menu in the new loading path', () => {
  it('"only this element" becomes the base — a bare set literal', () => {
    expect(applyCtxAction('only-this', 'd')).toBe(true);
    expect(letzteMdx()).toContain('{[aa].[aa].[d]}');
    expect(letzteMdx()).not.toContain('INTERSECT');
    expect(letzteMdx()).not.toContain('Members');
  });

  it('takes the marking if there is one', () => {
    toggleMark('a');
    toggleMark('b');
    applyCtxAction('only-this', 'd');
    const mdx = letzteMdx();
    expect(mdx).toContain('[aa].[aa].[a]');
    expect(mdx).toContain('[aa].[aa].[b]');
    expect(mdx).not.toContain('[aa].[aa].[d]');
  });

  it('"Clear filter/selection" empties the stack but keeps the base', () => {
    // Removing stays a LAYER — "everything except b" cannot be written as a
    // list. So that is what can be taken off here.
    toggleMark('a');
    removeMarked();
    expect(letzteMdx()).toContain('EXCEPT');
    applyCtxAction('clear-all', 'd');
    expect(letzteMdx()).not.toContain('EXCEPT');
    expect(letzteMdx()).toContain('[aa].[aa].Members');
  });

  it('"Keep" is the same act as "only these" — so the same shape', () => {
    toggleMark('a');
    toggleMark('b');
    keepMarked();
    const mdx = letzteMdx();
    expect(mdx).toContain('{[aa].[aa].[a],[aa].[aa].[b]}');
    expect(mdx).not.toContain('INTERSECT');
    expect(mdx).not.toContain('Members');
  });

  it('"collapse all" switches to the root base', () => {
    applyCtxAction('collapse-all', 'd');
    expect(letzteMdx()).toContain('Parent.Name = ""');
  });

  it('"Copy names" does not belong to the new path — it lets it through', () => {
    // `false` means "not my business": the old handler may keep serving the
    // clipboard, because that is not a set operation.
    const vorher = rowPosts().length;
    expect(applyCtxAction('copy-name', 'd')).toBe(false);
    expect(rowPosts()).toHaveLength(vorher);
    // No banner: the double creates elements only on access, so an
    // `undefined` proves that nobody reported anything.
    expect(els['error-banner']).toBeUndefined();
  });
});
