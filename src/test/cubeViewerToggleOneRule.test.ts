import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isCollapsedByDisplay, axisBaseFromTuples } from '../webviewClient/cubeViewerMonaco/gridPure';
import { drillDownMemberSet, drillUpMemberSet } from '../webviewClient/cubeViewerMonaco/mdxParts';

/**
 * C3 of the cleanup plan `2026-08-19-cleanup-cubeviewer-dimbrowser.md`.
 *
 * The cube viewer answered "is it collapsed?" three ways: from the visible
 * children (`localFocus`), from the filter list (`kind:'elements'`) and from the
 * marker `state.collapsed` (everything else). Since the filter chip (2026-08-20)
 * introduced a selection of the kind `kind:'expression'`, this fourth case fell into
 * the marker branch — and that one lied: the axis comes from a `DRILLUPMEMBER`,
 * so without child rows, yet the empty marker reported "expanded".
 *
 * Now the triangle reads what STANDS THERE in all four cases.
 */
describe('isCollapsedByDisplay — the one collapse rule', () => {
  const kinder = ['a1', 'a2'];

  it('expanded when a direct child stands below the occurrence', () => {
    expect(isCollapsedByDisplay(['A', 'a1', 'B'], 'A', kinder, 0)).toBe(false);
  });

  it('collapsed when no direct child stands below it', () => {
    expect(isCollapsedByDisplay(['A', 'B'], 'A', kinder, 0)).toBe(true);
  });

  it('collapsed when the children are not on the axis at all', () => {
    // The case of the expression axis: `DRILLUPMEMBER` removed them on the server side,
    // the client never saw them. Before, the empty marker reported
    // "expanded" here and the triangle showed ▾ on a row without children.
    expect(isCollapsedByDisplay(['A', 'B', 'C'], 'A', kinder, 0)).toBe(true);
  });

  it('answers per block, not per name', () => {
    // First occurrence expanded, second not.
    const seq = ['A', 'a1', 'B', 'A', 'C'];
    expect(isCollapsedByDisplay(seq, 'A', kinder, 0)).toBe(false);
    expect(isCollapsedByDisplay(seq, 'A', kinder, 1)).toBe(true);
  });

  it('does not count a child ABOVE the occurrence as "below"', () => {
    // Dragged out of its consolidation in the Dimension Browser
    // (live bug report 2026-08-01) — the row no longer hangs below it.
    expect(isCollapsedByDisplay(['a1', 'A', 'B'], 'A', kinder, 0)).toBe(true);
  });

  it('without an ordinal the first occurrence, without a hit non-positional', () => {
    const seq = ['A', 'a1', 'B', 'A'];
    expect(isCollapsedByDisplay(seq, 'A', kinder, -1)).toBe(false);
    // `elem` does not stand in the sequence at all: every position counts as below.
    expect(isCollapsedByDisplay(['x', 'a1'], 'A', kinder, 0)).toBe(false);
  });

  it('always collapsed without known children', () => {
    expect(isCollapsedByDisplay(['A', 'B'], 'A', [], 0)).toBe(true);
  });

  it('builds on the displayed sequence that `axisBaseFromTuples` delivers', () => {
    // Cross-product axis: the same inner sequence per outer block. Exactly that is what
    // `grid.ts` passes in as `seq`.
    const tuples = [['Q1', 'A'], ['Q1', 'a1'], ['Q2', 'A'], ['Q2', 'a1']];
    const seq = axisBaseFromTuples(tuples, 1);
    expect(seq).toEqual(['A', 'a1']);
    expect(isCollapsedByDisplay(seq!, 'A', kinder, 0)).toBe(false);
  });
});

/**
 * Collapsing on an expression axis is a statement about the MEMBER — measured
 * live (11.8, 2026-08-20, cvDrillOccurrenceProbe{,2}.js):
 * both drill forms hit EVERY occurrence. `{A,B,A}` with
 * `DRILLDOWNMEMBER(…,{A})` yielded 11 rows (both blocks open), and
 * `{A,kinder,B,A,kinder}` with `DRILLUPMEMBER(…,{A})` 3 again.
 */
describe('drill forms for the expression axis', () => {
  const SET = '{TM1SUBSETALL([Region].[Region])}';

  it('expands by wrapping the expression', () => {
    expect(drillDownMemberSet(SET, 'Region', 'North'))
      .toBe(`{DRILLDOWNMEMBER(${SET}, {FILTER({TM1FILTERBYPATTERN({[Region].[Region].Members}, "North")}, [Region].[Region].CurrentMember.Name = "North")})}`);
  });

  it('collapses by wrapping the expression', () => {
    expect(drillUpMemberSet(SET, 'Region', 'North'))
      .toBe(`{DRILLUPMEMBER(${SET}, {FILTER({TM1FILTERBYPATTERN({[Region].[Region].Members}, "North")}, [Region].[Region].CurrentMember.Name = "North")})}`);
  });

  it('nests — the collapse state grows as an expression', () => {
    const auf = drillDownMemberSet(SET, 'Region', 'North');
    const zu = drillUpMemberSet(auf, 'Region', 'South');
    expect(zu).toContain('DRILLUPMEMBER(');
    expect(zu).toContain('DRILLDOWNMEMBER(');
    expect(zu.indexOf('DRILLUPMEMBER(')).toBeLessThan(zu.indexOf('DRILLDOWNMEMBER('));
  });

  it('an element name with `]` stands unchanged in the string literal', () => {
    expect(drillUpMemberSet(SET, 'Region', 'A]B')).toContain('Name = "A]B"');
  });
});

/**
 * Source guard: the three old answers must not come back. A
 * reintroduced branch would be silent — the grid would keep drawing, only the
 * triangle would point in the wrong direction again.
 */
describe('source guard: `_toggleHtml` has exactly one answer', () => {
  // Since W3 (2026-10-05) the triangle renderer lives in gridLabels.ts.
  const src = readFileSync(
    join(__dirname, '..', 'webviewClient', 'cubeViewerMonaco', 'gridLabels.ts'),
    'utf8',
  );
  const body = (() => {
    const start = src.indexOf("function _toggleHtml(axis: 'row' | 'col'");
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('\n  return _toggleHtml;', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it('derives the answer from the display', () => {
    expect(body).toContain('isCollapsedByDisplay(');
  });

  it('no longer reads the marker `state.collapsed`', () => {
    expect(body).not.toContain('state.collapsed');
  });

  it('no longer branches by the kind of selection', () => {
    // ACCESS the state, not mention it in the comment — the
    // reasoning in the body names both old branches by name.
    expect(body).not.toContain('state.dimSelections');
    expect(body).not.toContain('state.localFocus');
  });

  it('stamps the answer onto the triangle, so that the click uses it too', () => {
    expect(body).toContain('data-coll=');
  });
});

/**
 * The click path itself is close to the DOM and cannot sensibly be executed here (the same
 * reasoning as in `cubeViewerToggleFilterNames.test.ts`). Testable is that it
 * serves the expression axis at all — before, it fell into the marker branch
 * and a click visibly did nothing, although the triangle showed ▸.
 */
describe('source guard: a click on an expression axis carries the expression forward', () => {
  // Since W3 (2026-10-05) the click dispatcher lives in gridClick.ts.
  const src = readFileSync(
    join(__dirname, '..', 'webviewClient', 'cubeViewerMonaco', 'gridClick.ts'),
    'utf8',
  );

  it('knows a branch of its own for `kind: \'expression\'`', () => {
    expect(src).toContain("selExpr?.kind === 'expression'");
  });

  it('takes the direction from the answer that drew the triangle', () => {
    expect(src).toContain('dataset.coll');
    expect(src).toContain('clickedColl');
  });

  it('uses both drill forms — expand AND collapse', () => {
    expect(src).toContain('drillDownMemberSet(');
    expect(src).toContain('drillUpMemberSet(');
  });

  it('reports the new expression to the host', () => {
    expect(src).toContain("type: 'setDimFilterExpression'");
  });

  it('clears away an old marker before the children come', () => {
    const branch = src.slice(
      src.indexOf("selExpr?.kind === 'expression'"),
      src.indexOf("// Server-side filter active"),
    );
    expect(branch).toContain('delete state.collapsed[dimName][elemName]');
  });
});
