import { describe, it, expect } from 'vitest';
import { storedMdx, fetchMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { initialView, toggleCollapse, freezeOrder } from '../webviewClient/dimensionBrowser/intents';

const D = 'aa', H = 'aa';

describe('stored form', () => {
  it('tree is `.Members`', () => {
    expect(storedMdx(initialView('tree'), D, H)).toBe('{[aa].[aa].Members}');
  });

  it('set is `TM1SUBSETALL`', () => {
    expect(storedMdx(initialView('set'), D, H)).toBe('{TM1SUBSETALL([aa].[aa])}');
  });

  it('roots filter on an empty parent name', () => {
    // `IsNull(Parent)` is MDX error 501 — the root test goes through the
    // empty parent name. CAUTION: this form comes from an earlier
    // measurement, not from this session — task 5 step 5 probes it live.
    expect(storedMdx(initialView('roots'), D, H))
      .toBe('{FILTER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Parent.Name = "")}');
  });

  it('collapsing is DRILLUPMEMBER', () => {
    const v = toggleCollapse(initialView('tree'), 'd');
    expect(storedMdx(v, D, H)).toBe('{DRILLUPMEMBER({[aa].[aa].Members}, {FILTER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "d")}, [aa].[aa].CurrentMember.Name = "d")})}');
  });

  it('several collapses nest in order', () => {
    let v = toggleCollapse(initialView('tree'), 'd');
    v = toggleCollapse(v, 'sum');
    expect(storedMdx(v, D, H)).toBe(
      '{DRILLUPMEMBER({DRILLUPMEMBER({[aa].[aa].Members}, {FILTER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "d")}, [aa].[aa].CurrentMember.Name = "d")})}, {FILTER({TM1FILTERBYPATTERN({[aa].[aa].Members}, "sum")}, [aa].[aa].CurrentMember.Name = "sum")})}',
    );
  });

  it('a frozen order is an enumerated set', () => {
    expect(storedMdx(freezeOrder(initialView('tree'), ['b', 'a']), D, H))
      .toBe('{[aa].[aa].[b],[aa].[aa].[a]}');
  });

  it('doubles `]` in the element name', () => {
    expect(storedMdx(freezeOrder(initialView('tree'), ['a]b']), D, H))
      .toBe('{[aa].[aa].[a]]b]}');
  });
});

describe('fetch form', () => {
  it('wraps the window as a SUBSET around the stored form', () => {
    expect(fetchMdx(initialView('tree'), D, H, 0, 200))
      .toBe('{SUBSET({[aa].[aa].Members}, 0, 201)}');
  });

  it('fetches ONE row more so that the window edge stays decidable', () => {
    // Without the extra row you cannot tell at the bottom edge whether the last
    // node is expanded — its children would lie outside.
    expect(fetchMdx(initialView('tree'), D, H, 400, 200))
      .toBe('{SUBSET({[aa].[aa].Members}, 400, 201)}');
  });

  it('leaves the stored form untouched', () => {
    const v = initialView('tree');
    fetchMdx(v, D, H, 0, 200);
    expect(storedMdx(v, D, H)).toBe('{[aa].[aa].Members}');
  });
});


