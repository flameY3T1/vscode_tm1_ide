import { describe, it, expect } from 'vitest';
import {
  initialView, pushIntent, popIntent, orderIsReplaced, toggleCollapse,
} from '../webviewClient/dimensionBrowser/intents';
import { storedMdx, fetchMdx } from '../webviewClient/dimensionBrowser/viewMdx';

const D = 'aa', H = 'aa';

describe('the stack', () => {
  it('appends a layer on top', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'pattern', pattern: '*x*' } });
    expect(v.intents).toHaveLength(1);
    expect(v.base.kind).toBe('tree');
  });

  it('takes off ONLY from the top — that is the point-in-time-x semantics', () => {
    let v = initialView('tree');
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'pattern', pattern: 'a*' } });
    v = pushIntent(v, { kind: 'collapse', member: 'xxx' });
    const zurueck = popIntent(v);
    expect(zurueck.intents).toHaveLength(1);
    // The LOWER layer stays unchanged: it evaluated its set at the
    // moment it was chosen, and taking back the top layer changes nothing about that.
    expect(zurueck.intents[0]).toEqual({ kind: 'filter', layer: { kind: 'pattern', pattern: 'a*' } });
  });

  it('toggleCollapse is the DELIBERATE exception: takes from the middle, not only from the top', () => {
    // Stack [collapse d, filter type C] — `d` sits at the bottom, the filter on top.
    // Re-expanding `d` via the triangle must remove the collapse layer
    // EVEN THOUGH it is not the topmost one: the basic rule "only from the top"
    // protects layers whose meaning depends on the set below them —
    // a filter is a pure predicate and does not have this problem (see the
    // doc comment on `Intent`/`toggleCollapse` in `intents.ts`). This test
    // PINS the behavior so that a later change is a deliberate one,
    // not an accidental fallback to the basic rule.
    let v = pushIntent(initialView('tree'), { kind: 'collapse', member: 'd' });
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    const aufgeklappt = toggleCollapse(v, 'd');
    expect(aufgeklappt.intents).toEqual([{ kind: 'filter', layer: { kind: 'type', types: ['C'] } }]);
    // storedMdx shows the same finding from the outside: the filter now wraps
    // directly around the base, the DRILLUPMEMBER is gone without a trace — no
    // recomputation of the filter over an intermediate set that never existed.
    expect(storedMdx(aufgeklappt, D, H)).toBe(
      '{FILTER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Properties("ELEMENT_TYPE") = "3")}',
    );
  });
});

describe('orderIsReplaced', () => {
  it('is false on a tree base without intents — that is the tree order', () => {
    expect(orderIsReplaced(initialView('tree'))).toBe(false);
  });

  it('is false for arbitrary intents on a tree base', () => {
    let v = initialView('tree');
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'pattern', pattern: 'a*' } });
    v = pushIntent(v, { kind: 'collapse', member: 'x' });
    expect(orderIsReplaced(v)).toBe(false);
  });

  it('is false for a roots base — a filter over tree order keeps the order', () => {
    expect(orderIsReplaced(initialView('roots'))).toBe(false);
  });

  it('is true for the base `explicit` — a manual order is not a tree order', () => {
    expect(orderIsReplaced({ base: { kind: 'explicit', names: ['b', 'a'] }, intents: [] })).toBe(true);
  });

  it('is true for the base `set` — TM1SUBSETALL is index order, not a tree', () => {
    expect(orderIsReplaced(initialView('set'))).toBe(true);
  });
});

describe('storedMdx nests in stack order', () => {
  it('wraps the filter around the base', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'pattern', pattern: '*x*' } });
    expect(storedMdx(v, D, H)).toBe('{TM1FILTERBYPATTERN({[aa].[aa].Members}, "*x*")}');
  });

  it('wraps filter and collapse in the order in which they were chosen', () => {
    let v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'pattern', pattern: '*x*' } });
    v = pushIntent(v, { kind: 'collapse', member: 'xxx' });
    expect(storedMdx(v, D, H)).toBe(
      '{DRILLUPMEMBER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "*x*")}, {FILTER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "xxx")}, [aa].[aa].CurrentMember.Name = "xxx")})}',
    );
  });

  it('sets a type filter as FILTER over ELEMENT_TYPE', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    expect(storedMdx(v, D, H)).toBe(
      '{FILTER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Properties("ELEMENT_TYPE") = "3")}',
    );
  });

  it('joins several types with OR', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'type', types: ['N', 'C'] } });
    expect(storedMdx(v, D, H)).toBe(
      '{FILTER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Properties("ELEMENT_TYPE") = "1" OR [aa].[aa].CurrentMember.Properties("ELEMENT_TYPE") = "3")}',
    );
  });

  it('sets a level filter as TM1FILTERBYLEVEL', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'level', levels: [2] } });
    expect(storedMdx(v, D, H)).toBe('{TM1FILTERBYLEVEL({[aa].[aa].Members}, 2)}');
  });

  // Measured 11.8 (2026-10-02): inside "…" a ]] stays two characters and ""
  // is one quote. The pattern is a string literal, not a bracket name.
  it('leaves ] in the pattern alone and doubles "', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'pattern', pattern: 'a]b"c' } });
    expect(storedMdx(v, D, H)).toBe('{TM1FILTERBYPATTERN({[aa].[aa].Members}, "a]b""c")}');
  });

  it('nests all layers', () => {
    let v = initialView('tree');
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'pattern', pattern: 'a*' } });
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    v = pushIntent(v, { kind: 'collapse', member: 'x' });
    expect(storedMdx(v, D, H)).toBe(
      '{DRILLUPMEMBER({FILTER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "a*")}, [aa].[aa].CurrentMember.Properties("ELEMENT_TYPE") = "3")}, {FILTER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "x")}, [aa].[aa].CurrentMember.Name = "x")})}',
    );
  });
});

describe('fetchMdx', () => {
  it('appends SUBSET – in the window', () => {
    const v = initialView('tree');
    expect(fetchMdx(v, D, H, 0, 200)).toBe(`{SUBSET(${storedMdx(v, D, H)}, 0, 201)}`);
  });
});
