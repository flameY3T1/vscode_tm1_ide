import { describe, it, expect } from 'vitest';
import { buildPivotedMdx } from '../webviewClient/cubeViewerMonaco/mdxPivotPure';

const base = {
  cube: 'Sales',
  rowDims: ['A'],
  colDims: ['C'],
  titleDims: ['D'],
  dimSubsets: { A: ['a1'], C: ['c1', 'c2'] } as Record<string, string[]>,
  titleAssignments: { D: 'd1' } as Record<string, string>,
  suppressRows: false,
  suppressCols: false,
};

describe('buildPivotedMdx', () => {
  it('places a context→row moved dim ON ROWS and NOT in WHERE (no double-inclusion)', () => {
    // B moved from titles onto rows.
    const mdx = buildPivotedMdx({
      ...base,
      rowDims: ['A', 'B'],
      titleDims: ['D'],
      dimSubsets: { A: ['a1'], B: ['b1', 'b2'], C: ['c1'] },
    });
    // B appears exactly once, on the ROWS axis, never in the WHERE slicer.
    expect(mdx).toContain('[B].[B].[b1]');
    const whereIdx = mdx.indexOf('WHERE');
    expect(whereIdx).toBeGreaterThan(-1);
    expect(mdx.slice(whereIdx)).not.toContain('[B].[B]'); // B not in slicer
    expect(mdx.slice(0, whereIdx)).toContain('[B].[B].[b1]'); // B on an axis
  });

  it('places a row→context moved dim in WHERE and NOT on any axis', () => {
    // B moved from rows into titles.
    const mdx = buildPivotedMdx({
      ...base,
      rowDims: ['A'],
      titleDims: ['D', 'B'],
      titleAssignments: { D: 'd1', B: 'b1' },
      dimSubsets: { A: ['a1'], C: ['c1'] },
    });
    const whereIdx = mdx.indexOf('WHERE');
    expect(mdx.slice(whereIdx)).toContain('[B].[B].[b1]'); // B in slicer
    expect(mdx.slice(0, whereIdx)).not.toContain('[B].[B]'); // B not on an axis
  });

  it('falls back to TM1SUBSETALL when a dim has no explicit subset', () => {
    const mdx = buildPivotedMdx({ ...base, dimSubsets: {} });
    expect(mdx).toContain('TM1SUBSETALL( [A].[A] )');
    expect(mdx).toContain('TM1SUBSETALL( [C].[C] )');
  });

  it('emits NON EMPTY prefixes when suppress flags are set', () => {
    const mdx = buildPivotedMdx({ ...base, suppressRows: true, suppressCols: true });
    expect(mdx).toContain('NON EMPTY');
    expect(mdx.match(/NON EMPTY/g)?.length).toBe(2);
  });

  it('doubles a closing bracket in dim/member names (MDX escape)', () => {
    const mdx = buildPivotedMdx({
      ...base,
      rowDims: ['Bahn]stellen'],
      dimSubsets: { 'Bahn]stellen': ['x]y'] },
    });
    expect(mdx).toContain('[Bahn]]stellen].[Bahn]]stellen].[x]]y]');
  });

  it('produces no WHERE clause when there are no title dims with an assignment', () => {
    const mdx = buildPivotedMdx({ ...base, titleDims: [], titleAssignments: {} });
    expect(mdx).not.toContain('WHERE');
  });
});
