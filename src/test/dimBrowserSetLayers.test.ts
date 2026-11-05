import { describe, it, expect, beforeEach, vi } from 'vitest';

// Since 2026-08-22 the trail and the banner take their texts from the bundle.
// The map stands BEFORE the imports because `viewTrail`/`viewPath` fetch it
// while the module loads; the values are the German ones, so that the
// expectations keep checking the MEANING and not the key.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    vwBaseMembers: 'Baum', vwBaseAll: 'Alle',
    vwTrailKept: 'behalten ({0})', vwTrailRemoved: 'entfernt ({0})',
    vwTrailCollapsed: 'zugeklappt {0}',
    vwTrailPopTitle: 'Diese Schicht zuruecknehmen',
    vwNothingMarked: 'Nichts markiert.',
    vwTooManyMarks: 'Zu viele Markierungen fuer eine Schicht (max. {0}).',
    loaded: '{0} von {1}',
  };
});

import { initialView, pushIntent, orderIsReplaced } from '../webviewClient/dimensionBrowser/intents';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { rowsFromAnswer } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import { trailHtml } from '../webviewClient/dimensionBrowser/viewTrail';
import type { AnswerRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import {
  startView, removeMarked, setBase, onViewRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { toggleMark, markCount, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';
import { keepMarked } from '../webviewClient/dimensionBrowser/viewLayers';

describe('keep and remove as layers', () => {
  it('remove becomes EXCEPT with ALL', () => {
    // WITHOUT `ALL`, "remove b" is a silent data loss: the second `a` row and
    // the second `x` row disappear as well (measured live, spec).
    const v = pushIntent(initialView('tree'), { kind: 'remove', names: ['b'] });
    expect(storedMdx(v, 'aa', 'aa'))
      .toBe('{EXCEPT({[aa].[aa].Members}, {[aa].[aa].[b]}, ALL)}');
  });

  it('keep becomes INTERSECT with ALL', () => {
    const v = pushIntent(initialView('tree'), { kind: 'keep', names: ['a', 'b'] });
    expect(storedMdx(v, 'aa', 'aa'))
      .toBe('{INTERSECT({[aa].[aa].Members}, {[aa].[aa].[a],[aa].[aa].[b]}, ALL)}');
  });

  it('square brackets in the name are doubled', () => {
    const v = pushIntent(initialView('tree'), { kind: 'remove', names: ['a]b'] });
    expect(storedMdx(v, 'aa', 'aa')).toContain('[a]]b]');
  });

  it('the layers wrap around the previous one, not side by side', () => {
    let v = initialView('tree');
    v = pushIntent(v, { kind: 'remove', names: ['b'] });
    v = pushIntent(v, { kind: 'keep', names: ['a'] });
    expect(storedMdx(v, 'aa', 'aa'))
      .toBe('{INTERSECT({EXCEPT({[aa].[aa].Members}, {[aa].[aa].[b]}, ALL)}, {[aa].[aa].[a]}, ALL)}');
  });

  it('neither reorders — indentation stays allowed', () => {
    // Measured (spec block A): filters and set operations take away and
    // do not reorder; only `TM1SORT` reorders.
    let v = initialView('tree');
    v = pushIntent(v, { kind: 'remove', names: ['b'] });
    v = pushIntent(v, { kind: 'keep', names: ['a'] });
    expect(orderIsReplaced(v)).toBe(false);
  });

  it('the trail names them with a COUNT, not with the whole list', () => {
    // Writing out 400 elements as a chip makes the trail unreadable. What exactly
    // is meant stands in full in the MDX bar above it.
    const v = pushIntent(initialView('tree'), { kind: 'remove', names: ['a', 'b', 'c'] });
    const html = trailHtml(v);
    expect(html).toContain('entfernt (3)');
    // Not just "no escaped tag" (that would never have ended up in the result
    // of `intentLabel`, regardless of the implementation) — but
    // concretely: the three names are NOT written out in the trail.
    expect(html).not.toMatch(/\ba\b.*\bb\b.*\bc\b/);
    const w = pushIntent(initialView('tree'), { kind: 'keep', names: ['a'] });
    expect(trailHtml(w)).toContain('behalten (1)');
  });
});

describe('the skip rule also carries the set layers', () => {
  function zeile(name: string, ancestors: string[], drilled = false): AnswerRow {
    return {
      name, caption: name, type: 'N', level: 0,
      parent: ancestors.length ? ancestors[ancestors.length - 1] : null,
      drilled,
      ancestors: ancestors.map((n) => ({ name: n, type: 'C' as const, level: 1 })),
    };
  }

  it('a REMOVED ancestor is skipped, the chain continues', () => {
    // `EXCEPT(Members, {xxx}, ALL)` leaves the children of xxx in place — they
    // become rows of a flatter level, not invisible.
    const v = pushIntent(initialView('tree'), { kind: 'remove', names: ['mitte'] });
    const out = rowsFromAnswer([zeile('kind', ['wurzel', 'mitte'])], v);
    // wurzel counts, mitte does not: depth 1 instead of 2.
    expect(out[0].depth).toBe(1);
  });

  it('an ancestor EXCLUDED via keep is skipped likewise', () => {
    const v = pushIntent(initialView('tree'), { kind: 'keep', names: ['wurzel', 'kind'] });
    const out = rowsFromAnswer([zeile('kind', ['wurzel', 'mitte'])], v);
    expect(out[0].depth).toBe(1);
  });

  it('a surviving ancestor still counts', () => {
    const v = pushIntent(initialView('tree'), { kind: 'remove', names: ['anderes'] });
    const out = rowsFromAnswer([zeile('kind', ['wurzel', 'mitte'])], v);
    expect(out[0].depth).toBe(2);
  });
});

/**
 * `keepMarked`/`removeMarked` (`viewPath.ts#setLayer`) are the only
 * PRODUCTION entry point of the new layers — the `storedMdx` tests above
 * check only the pure expression building, not the path from the mark
 * to the layer. End-to-end form like the `applyFilter` tests in
 * `dimBrowserViewToggle.test.ts`: bind `startView`, record the postings, filter out
 * `fetchViewRows`.
 */
describe('set layer: keepMarked/removeMarked drive startView end-to-end', () => {
  interface FakeEl {
    innerHTML: string;
    textContent: string;
    style: Record<string, string>;
    // The counter and the toggle touch both.
    classList: { contains: () => boolean; toggle: () => void; add: () => void; remove: () => void };
    setAttribute: () => void;
    addEventListener: (type: string, h: (e: unknown) => void) => void;
  }
  let posted: { type?: string; mdx?: string; requestId?: number; chain?: string }[] = [];
  let elements: Record<string, FakeEl> = {};
  const rowPosted = () => posted.filter((p) => p.type === 'fetchViewRows');
  function fakeElement(id: string): FakeEl {
    return {
      innerHTML: '',
      textContent: '',
      style: id === 'vw-trail' ? { display: 'none' } : {},
      classList: { contains: () => false, toggle: () => {}, add: () => {}, remove: () => {} },
      setAttribute: () => {},
      addEventListener: () => { /* no clicks in these tests */ },
    };
  }

  beforeEach(() => {
    posted = [];
    elements = {};
    _resetViewPathForTest();
    _resetMarksForTest();
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        if (!elements[id]) { elements[id] = fakeElement(id); }
        return elements[id];
      },
    };
  });

  it('removeMarked creates a layer with BOTH names and clears the mark', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    toggleMark('a');
    toggleMark('b');
    expect(markCount()).toBe(2);
    removeMarked();
    const gefeuert = rowPosted();
    // One posting on opening, a second one through removeMarked — the layer
    // really triggered a new fetch, not just changed the state.
    expect(gefeuert.length).toBeGreaterThan(1);
    const mdx = gefeuert[gefeuert.length - 1].mdx!;
    expect(mdx).toContain('EXCEPT');
    expect(mdx).toContain('[aa].[aa].[a]');
    expect(mdx).toContain('[aa].[aa].[b]');
    // Load-bearing: the mark is empty AFTER the layer has been created.
    // If `setLayer` forgets the `clearMarks()`, the next click creates
    // the same layer a second time — silently, plausibly, exactly the
    // failure case of this task.
    expect(markCount()).toBe(0);
  });

  it('without a mark no layer is created', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    const vorher = rowPosted().length;
    removeMarked();
    expect(rowPosted()).toHaveLength(vorher);
    keepMarked();
    expect(rowPosted()).toHaveLength(vorher);
  });

  it('above 5000 marks NO layer is created — capped at the '
    + 'highest MEASURED size', () => {
    // Important 6 (final review): 5000 is the highest MEASURED value,
    // spec block I. `EXCEPT`/`INTERSECT` with that many names would be ~500 KB
    // of MDX, sent for rows AND count and again on every
    // scroll append.
    startView('aa', 'aa', (m) => posted.push(m as never));
    for (let i = 0; i < 5001; i++) { toggleMark(`e${i}`); }
    expect(markCount()).toBe(5001);
    const vorher = rowPosted().length;
    removeMarked();
    expect(rowPosted()).toHaveLength(vorher);
    // No silent fallback: the mark stays in place, no layer.
    expect(markCount()).toBe(5001);
  });

  /**
   * Important 2 (final review): `setBase` is the only function of the new
   * path that discards the WHOLE stack AND the mark (base switch,
   * spec part I "The base is a control") — and had only a `() => {}` stub
   * in `src/test/`. End-to-end like `removeMarked` above.
   */
  it('setBase(\'set\') clears the mark, carries TM1SUBSETALL, no chips in the trail', () => {
    startView('aa', 'aa', (m) => posted.push(m as never));
    toggleMark('a');
    toggleMark('b');
    expect(markCount()).toBe(2);
    setBase('set');
    expect(markCount()).toBe(0);
    const gefeuert = rowPosted();
    expect(gefeuert.length).toBeGreaterThan(1);
    const letzte = gefeuert[gefeuert.length - 1];
    const mdx = letzte.mdx!;
    expect(mdx).toContain('TM1SUBSETALL');
    // Redeem the response to EXACTLY this request, so that the trail is really
    // drawn — otherwise the following assertion only checks the empty
    // starting state of the test double, not the behaviour of `setBase`.
    onViewRows({
      type: 'viewRows', requestId: letzte.requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [], hasMore: false,
    } as never);
    // The trail has only the base, no chip — the stack fell away with the
    // base switch, not merely the mark.
    expect(elements['vw-trail'].innerHTML).not.toContain('vw-trail-chip');
  });
});
