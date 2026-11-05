import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, setAlias, onViewRows, setMdxBase, currentMdx,
  _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import {
  subsetSaveInput, loadSubsetIntoView,
} from '../webviewClient/dimensionBrowser/subsetSource';

let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };

const zeile = (name: string) => ({
  name, caption: name, type: 'N' as const, level: 0, parent: null,
  ancestors: [], drilled: false,
});

function antworte(rows: string[], hasMore = false): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
    ok: true, rows: rows.map(zeile), cardinality: rows.length, hasMore,
  } as never);
}

describe('Saving a subset from the new path', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('takes the visible rows, the display alias and the expression', () => {
    startView('aa', 'aa', post);
    setAlias('SITENAME');
    antworte(['a', 'b', 'c']);
    const e = subsetSaveInput();
    expect(e.names).toEqual(['a', 'b', 'c']);
    expect(e.alias).toBe('SITENAME');
    expect(e.expression).toBe(currentMdx());
    expect(e.complete).toBe(true);
  });

  it('reports INCOMPLETE as long as the server has more than is loaded', () => {
    // The critical point: the new path only holds a window. A STATIC
    // save would silently turn that into a subset of 5000 instead of
    // 1.6 million elements — data loss without any message.
    startView('aa', 'aa', post);
    antworte(['a', 'b'], true);
    expect(subsetSaveInput().complete).toBe(false);
  });

});

describe('Loading a subset into the new path', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('a DYNAMIC subset becomes the MDX base', () => {
    // Its expression IS the answer — exactly what `Base.kind = 'mdx'` means.
    startView('aa', 'aa', post);
    const ok = loadSubsetIntoView({
      subsetName: 'S', isPrivate: false, elements: ['a'],
      expression: '{TM1SUBSETALL([aa].[aa])}', alias: null,
    } as never);
    expect(ok).toBe(true);
    expect(currentMdx()).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

  it('a STATIC subset becomes the name base, in its own order', () => {
    startView('aa', 'aa', post);
    loadSubsetIntoView({
      subsetName: 'S', isPrivate: false, elements: ['d', 'a', 'c'],
      expression: null, alias: null,
    } as never);
    expect(currentMdx()).toBe('{[aa].[aa].[d],[aa].[aa].[a],[aa].[aa].[c]}');
  });

  it('takes over the alias under which the subset was saved', () => {
    startView('aa', 'aa', post);
    loadSubsetIntoView({
      subsetName: 'S', isPrivate: false, elements: ['a'],
      expression: null, alias: 'SITENAME',
    } as never);
    expect((posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { alias?: string }).alias)
      .toBe('SITENAME');
  });

  it('an UNREAD expression is NOT interpreted as static', () => {
    // `expression: null` used to mean both — "static" and "could not
    // be read". A read error silently turned that into a
    // static subset. Here the view stays unchanged and the caller
    // gets `false`.
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    const vorher = currentMdx();
    const ok = loadSubsetIntoView({
      subsetName: 'S', isPrivate: false, elements: ['a'],
      expression: null, expressionUnread: true, alias: null,
    } as never);
    expect(ok).toBe(false);
    expect(currentMdx()).toBe(vorher);
  });

});

// ---------------------------------------------------------------------------

import { saveIsSafe } from '../webviewClient/dimensionBrowser/subsetSource';

describe('An incomplete window must not be saved silently', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('fully loaded: both kinds are safe', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b']);
    expect(saveIsSafe(subsetSaveInput(), true)).toBe(true);
    expect(saveIsSafe(subsetSaveInput(), false)).toBe(true);
  });

  it('incomplete: DYNAMIC is safe, STATIC is not', () => {
    // The expression describes the whole set, no matter how much of it is
    // loaded. The name list only describes the window.
    startView('aa', 'aa', post);
    antworte(['a', 'b'], true);
    expect(saveIsSafe(subsetSaveInput(), true)).toBe(true);
    expect(saveIsSafe(subsetSaveInput(), false)).toBe(false);
  });

  it('incomplete AND without an expression: nothing is safe', () => {
    expect(saveIsSafe(
      { names: ['a'], alias: '', expression: null, complete: false }, true,
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------

import { dynamicSavePlanForView } from '../webviewClient/dimensionBrowser/subsetSource';

describe('Save as MDX must ALWAYS be offered in the new path', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('offers the view expression — even without a loaded subset and without a drill', () => {
    // The old path derived the offer from the drill context and the composition.
    // The new path keeps neither, so the checkbox was greyed out and every
    // save silently fell back to the flat list (click test
    // 2026-08-23) — even though the expression was there the whole time.
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    const plan = dynamicSavePlanForView({ name: 'Neu', isPrivate: true });
    expect(plan.available).toBe(true);
    expect(plan.expression).toBe(currentMdx());
  });

  it('refuses the SELF-REFERENCE — it would delete the members', () => {
    // Live 11.8: a subset whose expression refers to itself loses its members
    // on write. Better a refusal than an empty subset.
    startView('aa', 'aa', post);
    setMdxBase('{TM1SubsetToSet([aa].[aa], "Meins")}');
    const plan = dynamicSavePlanForView({ name: 'Meins', isPrivate: true });
    expect(plan.available).toBe(false);
    expect(plan.reason).toBe('base-is-target');
  });

  it('an expression on a DIFFERENT subset stays allowed', () => {
    startView('aa', 'aa', post);
    setMdxBase('{TM1SubsetToSet([aa].[aa], "Fremd")}');
    expect(dynamicSavePlanForView({ name: 'Meins', isPrivate: true }).available).toBe(true);
  });

  it('the self-reference is detected case-insensitively', () => {
    startView('aa', 'aa', post);
    setMdxBase('{TM1SUBSETTOSET([aa].[aa], "MEINS")}');
    expect(dynamicSavePlanForView({ name: 'meins', isPrivate: true }).available).toBe(false);
  });

});

// ---------------------------------------------------------------------------

import {
  applySubsetPseudoInView, applyDefaultMemberInView,
} from '../webviewClient/dimensionBrowser/subsetSource';
import { flashBanner } from '../webviewClient/dimensionBrowser/banner';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

describe('The default entries of the subset field', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('"All" clears the stack and returns to the starting base', () => {
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    expect(applySubsetPseudoInView('__all__')).toBe(true);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });

  it('"Top level only" is the root base', () => {
    startView('aa', 'aa', post);
    expect(applySubsetPseudoInView('__toplevel__')).toBe(true);
    expect(currentMdx()).toContain('Parent.Name = ""');
  });

  it('"N-level" is LEVEL 0, not the element type N', () => {
    // Measured live (11.8, `Stations`): `TM1FILTERBYLEVEL(alle, 0)` returns
    // 61, `ELEMENT_TYPE = "1"` only 60 — the difference is the
    // string element. The old path once had the quick filter
    // "N only" here and silently lost the S element with it.
    startView('aa', 'aa', post);
    expect(applySubsetPseudoInView('__nlevel__')).toBe(true);
    expect(currentMdx()).toBe('{TM1FILTERBYLEVEL({TM1SUBSETALL([aa].[aa])}, 0)}');
  });

  it('"Default element" asks the server and takes over the answer', () => {
    startView('aa', 'aa', post);
    expect(applySubsetPseudoInView('__default__')).toBe(true);
    expect(posted.filter((p) => p.type === 'fetchDefaultMember')).toHaveLength(1);
    expect(applyDefaultMemberInView('sum')).toBe(true);
    expect(currentMdx()).toBe('{[aa].[aa].[sum]}');
  });

  it('an empty default element changes nothing', () => {
    startView('aa', 'aa', post);
    const vorher = currentMdx();
    expect(applyDefaultMemberInView(null)).toBe(true);
    expect(currentMdx()).toBe(vorher);
  });

  it('a real subset name is NOT a default entry', () => {
    startView('aa', 'aa', post);
    expect(applySubsetPseudoInView('pub:Meins')).toBe(false);
  });

});

describe('The queries of the new path do NOT report themselves as a refused action', () => {
  beforeEach(() => {
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    vi.mocked(flashBanner).mockClear();
  });

  it('merely asking shows no banner', () => {
    // `blockLegacyControlInNewViewPath` shows a banner on EVERY call —
    // it is a refusal, not a query. `_syncDynamicSaveRow` runs on every
    // keystroke in the name field, so while typing the subset name
    // "not available in this path yet" kept appearing (click test 2026-08-23).
    startView('aa', 'aa', post);
    subsetSaveInput();
    dynamicSavePlanForView({ name: 'x', isPrivate: true });
    applySubsetPseudoInView('pub:Meins');
    expect(vi.mocked(flashBanner)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('Reloading a subset resets the layers above it', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('the DYNAMIC subset comes back cleanly even though the base is the same', () => {
    // The actual case behind "Refresh": after filtering, the base IS
    // still the same expression, the filters only sit on top of it. Whoever checks
    // for equality here and returns early makes the button ineffective.
    startView('aa', 'aa', post);
    const laden = (): boolean => loadSubsetIntoView({
      subsetName: 'S', isPrivate: false, elements: ['a'],
      expression: '{TM1SUBSETALL([aa].[aa])}', alias: null,
    } as never);
    laden();
    applyFilter({ kind: 'type', types: ['C'] });
    expect(currentMdx()).toContain('ELEMENT_TYPE');
    laden();
    expect(currentMdx()).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

  it('and the STATIC one likewise', () => {
    startView('aa', 'aa', post);
    const laden = (): boolean => loadSubsetIntoView({
      subsetName: 'S', isPrivate: false, elements: ['d', 'a'],
      expression: null, alias: null,
    } as never);
    laden();
    applyFilter({ kind: 'type', types: ['C'] });
    laden();
    expect(currentMdx()).toBe('{[aa].[aa].[d],[aa].[aa].[a]}');
  });
});
