import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Several modules under test read `getL10n()` at module level — the map MUST
// be in place before the (hoisted) static imports.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    saved: 'SAVED',
    saveFailed: 'SAVE_FAILED',
    unknownError: 'UNKNOWN',
    mdxSubsetError: 'MDX_ERR: {0}',
    drillNoElementsAtLevel: 'NO_ELEMS_AT_LEVEL',
    memberStructureCapped: 'CAPPED:{0}',
    markedCount: 'MARKED:{0}',
    optAll: 'ALL', optNLevel: 'NLEVEL', optTopLevel: 'TOP', optDefaultElement: 'DEFAULT',
    optgroupPublic: 'PUB', optgroupPrivate: 'PRIV', subsetDynamicTitle: 'DYN',
  };
});

import * as fs from 'fs';
import * as path from 'path';
import { state } from '../webviewClient/dimensionBrowser/state';
import { initMsgHandler } from '../webviewClient/dimensionBrowser/msg';
import { MSG_SCOPE } from '../webviewClient/dimensionBrowser/msgScope';
import type { HostToWebview } from '../webviewClient/dimensionBrowser/protocol';
import { markCount, toggleMark, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';

/**
 * CHARACTERIZATION of the selection guards (S2-5, 2026-08-02).
 *
 * Written before the refactor to pin down the TRUTH TABLE of the eleven
 * individually hand-written `isCurrentSelection` calls: which response is
 * let through, which is discarded — and exactly where the two special rules
 * (`hier || dim` normalization, cold-start tolerance) make the difference.
 *
 * The tests do NOT look at the implementation: no `isCurrentSelection`,
 * no scope table, no epoch field. They post a message and only ask whether
 * the state has changed. That makes them valid before AND after any
 * refactor of the guard wiring — which is exactly their purpose: a change
 * that decides differently than before at any one place turns red here.
 *
 * Why every case comes in a PAIR (let through once, discarded once):
 * there is no jsdom in the repo, so the handlers only run until the first
 * real DOM access and then throw. A "nothing happens" alone would therefore
 * prove nothing — it could just as well be an early crash. Only the
 * pass-through twin with an identical message (only Dim/Hier differ) shows
 * that the path actually carries through to the observed mutation.
 */

// ── Fake-DOM ────────────────────────────────────────────────────────────────
interface FakeEl {
  style: Record<string, string>;
  className: string;
  textContent: string;
  innerHTML: string;
  value: string;
  disabled: boolean;
  selectedIndex: number;
  options: { value: string }[];
  classList: { add: (c: string) => void; remove: (c: string) => void };
}

function makeEl(): FakeEl {
  return {
    style: {}, className: '', textContent: '', innerHTML: '', value: '',
    disabled: false, selectedIndex: -1, options: [],
    classList: { add: () => {}, remove: () => {} },
  };
}

let els: Record<string, FakeEl>;
let handler: (e: { data: HostToWebview }) => void;

/** ids that must resolve to `null` — the handlers have explicit "no element" paths for these. */
const ABSENT = new Set<string>(['subset-select', 'alias-select']);

function install(): void {
  els = {};
  (globalThis as unknown as Record<string, unknown>).document = {
    getElementById: (id: string): FakeEl | null => {
      if (ABSENT.has(id)) { return null; }
      return els[id] ?? (els[id] = makeEl());
    },
  };
  const listeners: Array<(e: { data: HostToWebview }) => void> = [];
  (globalThis as unknown as Record<string, unknown>).window = {
    addEventListener: (_t: string, cb: (e: { data: HostToWebview }) => void) => { listeners.push(cb); },
  };
  initMsgHandler({ vscode: null });
  handler = listeners[0];
}

/** Post a message; a DOM-less tail throwing further down is not the subject here. */
function post(msg: unknown): void {
  try { handler({ data: msg as HostToWebview }); } catch { /* DOM-less tail */ }
}

function resetState(dim: string, hier: string): void {
  state._currentDim = dim;
  state._currentHier = hier;
  // Page mode off: the tests here check the SELECTION guard, and in page
  // mode an expressible subset has taken the server path since 2026-08-08
  // (`msgSubset.ts`), so it deliberately no longer sets a member filter. A
  // previous page response in this file would otherwise leak through to here.
  state._allData = { elements: [], edges: [], attrDefs: [] } as never;
  state._subsetSourceExpression = null;
  state._subsetExpressionOf = null;
  state._mode = 'standalone';
  state._lastSavedSubset = null;
  state._pendingInitialSubset = null;
}

beforeEach(() => {
  install();
  resetState('DimB', 'HierB');
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

const ROW = (n: string): unknown => ({ Name: n, Type: 'N', Level: 0, Attributes: [] });

// ── 1) setElementPage — strict Dim+Hier equality on the element list ─────
describe('setElementPage — the loaded list', () => {
  const load = (dim: string, hier: string): unknown => ({
    type: 'setElementPage', dimName: dim, hierName: hier, seq: 9,
    elements: [ROW('A1')], offset: 0, total: 1, hasMore: false, query: '', replace: true,
    filtered: false, attrDefs: [],
  });

  it('discards a response for a different dimension', () => {
    const keep = { elements: [ROW('B1')], edges: [], attrDefs: [] };
    state._allData = keep as never;
    post(load('DimA', 'HierA'));
    expect(state._allData).toBe(keep);
  });

  it('discards a response for a different HIERARCHY of the same dimension', () => {
    const keep = { elements: [ROW('B1')], edges: [], attrDefs: [] };
    state._allData = keep as never;
    post(load('DimB', 'HierA'));
    expect(state._allData).toBe(keep);
  });
});

// ── 2) setElementPage — the same equality, plus the seq ordering ─────

// ── 3) setElementAttributes ─────────────────────────────────────────────────

// ── 4) setSubsetElements ────────────────────────────────────────────────────
describe('setSubsetElements', () => {
  const sub = (dim: string, hier: string): unknown => ({
    type: 'setSubsetElements', dimName: dim, hierName: hier,
    subsetName: 'S', isPrivate: false, elements: ['S1'], expression: '{X}', alias: null,
  });

  it('discards a response for a different Dim/Hier — the MDX binding stays', () => {
    // Until 2026-08-26 this case additionally checked `_subsetFilter` and
    // `_pageBaseMdx`. Both were fields of the old load path with no
    // writer (review 2026-08-24, H6); what remains is the binding that the
    // new path actually maintains.
    post(sub('DimA', 'HierA'));
    expect(state._subsetSourceExpression).toBeNull();
  });

  // Since the single load path (26efdcd8), what an ACCEPTED response leaves
  // behind is the base of the page query, no longer a member filter over the
  // loaded slice: a subset that can be stated as an expression — here public with
  // a rule — lets the server do the windowing (`msgSubset.ts`). The guard's question
  // stays the same; only the state in which it shows up is a different one.
});

// ── 5) memberStructure ──────────────────────────────────────────────────────

// ── 6) subsetMdxResult — SPECIAL RULE `hier || dim` ──────────────────────────

// ── 7) setSubsetExpression — SPECIAL RULE cold start + `hier || dim` ──────────

// ── 8) subtree ──────────────────────────────────────────────────────────────

// ── 9) subtreeAborted ───────────────────────────────────────────────────────

// ── 10) ancestors ───────────────────────────────────────────────────────────
describe('ancestors', () => {
  const an = (dim: string, hier: string): unknown => ({
    type: 'ancestors', dimName: dim, hierName: hier, element: 'C1',
    elements: [ROW('R')], edges: [{ ParentName: 'R', ComponentName: 'C1' }],
  });

  it('discards a response for a different Dim/Hier — no foreign edges in _allData', () => {
    const keep = { elements: [ROW('C1')], edges: [], attrDefs: [] };
    state._allData = keep as never;
    post(an('DimA', 'HierA'));
    expect((state._allData as unknown as { elements: unknown[] }).elements).toHaveLength(1);
  });

});

// ── 11) subsetSaveResult — DELAYED guard, not a router case ────────────
//
// This message carries no Dim/Hier at all. Its guard does not compare the
// response with the present, but the present with the pair that was saved
// for — recorded on arrival, checked 600 ms later in the timer (K16).
describe('subsetSaveResult (delayed)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const ok = (): unknown => ({ type: 'subsetSaveResult', ok: true, message: 'ok' });

  it('discards the state takeover when the hierarchy has been switched in the meantime', () => {
    state._lastSavedSubset = { name: 'S', isPrivate: false, elements: ['S1'] } as never;
    post(ok());
    state._currentHier = 'HierC';           // switch DURING the 600 ms
    try { vi.advanceTimersByTime(700); } catch { /* DOM-less tail */ }
    expect(state._subsetSourceExpression).toBeNull();
  });


  it('clears the marks in BOTH cases (cleanup always applies)', () => {
    // Since 2026-08-26 the mark store is `viewMarks`; `state._markedNames`
    // was a dead field, so clearing it had no effect (review 2026-08-24, H6).
    _resetMarksForTest();
    toggleMark('A');
    state._lastSavedSubset = { name: 'S', isPrivate: false, elements: ['S1'] } as never;
    post(ok());
    state._currentHier = 'HierC';
    try { vi.advanceTimersByTime(700); } catch { /* DOM-less tail */ }
    expect(markCount()).toBe(0);
  });
});

// ── 12) setSubsets — DELIBERATELY UNCHECKED (inventory) ───────────────────
//
// `setSubsets` carries Dim/Hier but has no guard. That is not an oversight
// of this test but the state before AND after S2-5: the message only fills
// the dropdown, which the next `fetchSubsets` overwrites again anyway.
// Recorded so that guarding it later is a deliberate decision
// and does not slip through as a silent change in behavior.
describe('setSubsets — deliberately unchecked', () => {
  // This one message NEEDS the dropdown — it fills it. The other tests
  // deliberately keep it absent, because `setSubsetElements` has its second
  // guard on it (response against the currently selected subset).
  beforeEach(() => { ABSENT.delete('subset-select'); });
  afterEach(() => { ABSENT.add('subset-select'); });

  it('is processed even for a foreign Dim/Hier (unchecked today)', () => {
    state._pendingInitialSubset = { name: 'S', isPrivate: false } as never;
    post({ type: 'setSubsets', dimName: 'DimA', hierName: 'HierA', subsets: [] });
    expect(state._pendingInitialSubset).toBeNull();   // consumed ⇒ not discarded
  });
});

// ── 13) The proof: the epoch cannot be forgotten ──────────────────
//
// The first half of the proof is carried by the COMPILER: `MSG_SCOPE` is a
// mapped type over `HostToWebview['type']` — a new message type without an
// entry breaks `npm run typecheck`. And `ScopeOf<>` only allows `'unscoped'`
// for a message without `dimName`/`hierName`; classifying it as 'strict'
// would be a compile error there as well.
//
// What the compiler CANNOT tell, the two scans here check: that the
// table really names every type declared in `protocol.ts` (an alias
// or a rename could shrink the union unnoticed), and that
// nobody writes a twelfth guard back into a handler by hand.
describe('S2-5 — completeness of the scope table', () => {
  const CLIENT = path.resolve(__dirname, '../webviewClient/dimensionBrowser');
  const read = (f: string): string => fs.readFileSync(path.join(CLIENT, f), 'utf8');

  /** Every `type: 'x'` literal declared inside the HostToWebview union. */
  function declaredHostTypes(): string[] {
    const src = read('protocol.ts');
    const start = src.indexOf('export type HostToWebview');
    const end = src.indexOf('export type WebviewToHost');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const union = src.slice(start, end);
    return [...union.matchAll(/type:\s*'([^']+)'/g)].map((m) => m[1]);
  }

  it('names every message type declared in protocol.ts — and no other', () => {
    const declared = [...new Set(declaredHostTypes())].sort();
    expect(declared.length).toBeGreaterThan(10);   // protection against an empty scan
    expect(Object.keys(MSG_SCOPE).sort()).toEqual(declared);
  });

  it('assigns every type to a known scope', () => {
    const known = new Set(['strict', 'hierFallback', 'coldStartTolerant', 'unscoped']);
    for (const [type, scope] of Object.entries(MSG_SCOPE)) {
      expect(known.has(scope), `${type} → ${scope}`).toBe(true);
    }
  });

  // Same pattern as `noManualBodyRelease.test.ts`: the old, scattered
  // pattern must not come back. `msg.ts` is exempt because the delayed
  // K16 comparison lives there — it checks the present against a
  // snapshot, not a response against the present.
  it('no hand-written guard left in the topic handlers', () => {
    for (const f of ['msgSession.ts', 'msgSubset.ts', 'msgDrill.ts']) {
      expect(read(f), `${f} darf isCurrentSelection nicht selbst rufen`)
        .not.toMatch(/isCurrentSelection/);
    }
  });

  it('the predicate has exactly two callers: the router head and the delayed comparison', () => {
    const callers = fs.readdirSync(CLIENT)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => f !== 'pure.ts')
      .filter((f) => /isCurrentSelection\s*\(/.test(read(f)))
      .sort();
    expect(callers).toEqual(['msg.ts', 'msgScope.ts']);
  });
});
