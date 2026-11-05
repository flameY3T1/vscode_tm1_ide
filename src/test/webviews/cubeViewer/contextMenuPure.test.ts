import { describe, it, expect } from 'vitest';
import {
  buildAxisInfo,
  collectParentsUnion,
  eligibleCCells,
  collectAncestorsBfs,
  collectDescendantsDfs,
  collectDirectChildren,
  keepOnlyNames,
  type AxisInfo,
  type MatrixLike,
} from '../../../webviewClient/cubeViewerMonaco/contextMenuPure';
import { buildCubeStructure } from '../../../webviewClient/cubeViewerMonaco/cubeHierStructure';
import { leaves, children, expandAllSet, allParents, parents } from '../../../webviewClient/_shared/hierarchy/operations';

const dummyAxis = (
  parents: Record<string, string> = {},
  allParents: Record<string, string[]> = {},
): AxisInfo => {
  const children: Record<string, string[]> = {};
  for (const c in parents) { (children[parents[c]] ??= []).push(c); }
  return { parents, allParents, children, hasChildren: {} };
};

describe('buildAxisInfo', () => {
  it('returns null for missing matrix', () => {
    expect(buildAxisInfo(null, 'D', [], [])).toBeNull();
    expect(buildAxisInfo(undefined, 'D', [], [])).toBeNull();
  });
  it('returns null when dim is not in row or col axes', () => {
    const m: MatrixLike = { rowDims: ['X'], colDims: ['Y'], rowParents: [{}], colParents: [{}] };
    expect(buildAxisInfo(m, 'Z', [], [])).toBeNull();
  });
  it('uses fallback rowDims/colDims when matrix omits them', () => {
    const m: MatrixLike = { rowParents: [{ a: 'b' }] };
    const info = buildAxisInfo(m, 'Region', ['Region'], []);
    expect(info).not.toBeNull();
    expect(info!.parents).toEqual({ a: 'b' });
  });
  it('locates dim in row axis and builds children map', () => {
    const m: MatrixLike = {
      rowDims: ['Region'],
      rowParents: [{ DE: 'EU', FR: 'EU', US: 'NA' }],
      rowAllParents: [{ DE: ['EU'], FR: ['EU'] }],
    };
    const info = buildAxisInfo(m, 'Region', [], [])!;
    expect(info.children.EU.sort()).toEqual(['DE', 'FR']);
    expect(info.children.NA).toEqual(['US']);
    expect(info.allParents.DE).toEqual(['EU']);
  });
  it('locates dim in col axis when not in row', () => {
    const m: MatrixLike = {
      rowDims: ['Other'], colDims: ['Period'],
      rowParents: [{}], colParents: [{ Jan: 'Q1', Feb: 'Q1' }],
    };
    const info = buildAxisInfo(m, 'Period', [], [])!;
    expect(info.parents).toEqual({ Jan: 'Q1', Feb: 'Q1' });
    expect(info.children.Q1.sort()).toEqual(['Feb', 'Jan']);
  });
  it('defaults allParents to {} when matrix lacks it', () => {
    const m: MatrixLike = { rowDims: ['D'], rowParents: [{ a: 'b' }] };
    const info = buildAxisInfo(m, 'D', [], [])!;
    expect(info.allParents).toEqual({});
  });

  // Since the axis trimming, the reverse index `children` is only built over
  // what has been loaded. "Has children" must therefore come from the host, otherwise
  // precisely a collapsed consolidation looks childless.
  it('takes hasChildren of the row axis from the host', () => {
    const m: MatrixLike = {
      rowDims: ['Region'], rowParents: [{ DE: 'EU' }], rowHasChildren: [{ EU: true, DE: true }],
    };
    const info = buildAxisInfo(m, 'Region', [], [])!;
    // DE has NO children in the reverse index — the host says yes anyway.
    expect(info.children.DE).toBeUndefined();
    expect(info.hasChildren.DE).toBe(true);
  });
  it('takes hasChildren of the column axis from the host', () => {
    const m: MatrixLike = {
      rowDims: ['Other'], colDims: ['Period'],
      rowParents: [{}], colParents: [{ Jan: 'Q1' }], colHasChildren: [{ Q1: true }],
    };
    expect(buildAxisInfo(m, 'Period', [], [])!.hasChildren).toEqual({ Q1: true });
  });
  it('defaults hasChildren to {} when matrix lacks it', () => {
    const m: MatrixLike = { rowDims: ['D'], rowParents: [{ a: 'b' }] };
    expect(buildAxisInfo(m, 'D', [], [])!.hasChildren).toEqual({});
  });
});

describe('collectParentsUnion', () => {
  it('returns empty when no elems', () => {
    const info = dummyAxis({}, {});
    expect(collectParentsUnion([], info)).toEqual([]);
  });
  it('prefers allParents when populated', () => {
    const info = dummyAxis({ A: 'X' }, { A: ['X', 'Y'] });
    expect(collectParentsUnion(['A'], info)).toEqual(['X', 'Y']);
  });
  it('falls back to single-parent map when allParents missing or empty', () => {
    const info = dummyAxis({ A: 'X' }, { A: [] });
    expect(collectParentsUnion(['A'], info)).toEqual(['X']);
  });
  it('dedupes across multiple elements, preserves first-seen order', () => {
    const info = dummyAxis(
      { A: 'X', B: 'X', C: 'Y' },
      { A: ['X', 'Y'], B: ['X'], C: ['Y', 'Z'] },
    );
    expect(collectParentsUnion(['A', 'B', 'C'], info)).toEqual(['X', 'Y', 'Z']);
  });
  it('skips elements with no parents in either map', () => {
    const info = dummyAxis({}, {});
    expect(collectParentsUnion(['orphan'], info)).toEqual([]);
  });
});

describe('eligibleCCells', () => {
  it('returns empty when flagMap is empty', () => {
    expect(eligibleCCells([{ ri: 0, ci: 0 }], {})).toEqual([]);
  });
  it('passes consolidated, non-rule, non-locked cells', () => {
    const flags = { '0,0': { c: 1, r: 0, u: 1 } };
    expect(eligibleCCells([{ ri: 0, ci: 0 }], flags)).toEqual([{ ri: 0, ci: 0 }]);
  });
  it('rejects non-consolidated (c !== 1)', () => {
    expect(eligibleCCells([{ ri: 0, ci: 0 }], { '0,0': { c: 0, r: 0, u: 1 } })).toEqual([]);
  });
  it('rejects rule-derived (r === 1)', () => {
    expect(eligibleCCells([{ ri: 0, ci: 0 }], { '0,0': { c: 1, r: 1, u: 1 } })).toEqual([]);
  });
  it('rejects locked (u === 0)', () => {
    expect(eligibleCCells([{ ri: 0, ci: 0 }], { '0,0': { c: 1, r: 0, u: 0 } })).toEqual([]);
  });
  it('filters a mixed batch', () => {
    const cells = [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }, { ri: 1, ci: 0 }];
    const flags = {
      '0,0': { c: 1, r: 0, u: 1 },
      '0,1': { c: 1, r: 1, u: 1 },
      '1,0': { c: 1, r: 0, u: 1 },
    };
    expect(eligibleCCells(cells, flags)).toEqual([{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }]);
  });
});

describe('collectAncestorsBfs', () => {
  it('returns empty for no ancestors', () => {
    const info = dummyAxis({}, {});
    expect([...collectAncestorsBfs(['leaf'], info)]).toEqual([]);
  });
  it('walks single-parent chain', () => {
    const info = dummyAxis({ a: 'b', b: 'c' }, {});
    expect([...collectAncestorsBfs(['a'], info)].sort()).toEqual(['b', 'c']);
  });
  it('walks multi-parent ancestors via allParents', () => {
    const info = dummyAxis({}, { a: ['p1', 'p2'], p1: ['gp'], p2: ['gp'] });
    expect([...collectAncestorsBfs(['a'], info)].sort()).toEqual(['gp', 'p1', 'p2']);
  });
  it('safe on cyclic allParents input', () => {
    const info = dummyAxis({}, { A: ['B'], B: ['A'] });
    expect([...collectAncestorsBfs(['A'], info)].sort()).toEqual(['A', 'B']);
  });
  it('does NOT include targets themselves unless re-reached via cycle', () => {
    const info = dummyAxis({ a: 'b', b: 'c' }, {});
    const out = collectAncestorsBfs(['a'], info);
    expect(out.has('a')).toBe(false);
  });
});

describe('collectDescendantsDfs', () => {
  it('returns targets only when no children', () => {
    const info = dummyAxis({}, {});
    expect([...collectDescendantsDfs(['x'], info)]).toEqual(['x']);
  });
  it('walks deep tree', () => {
    const info = dummyAxis({ b: 'a', c: 'a', d: 'b' }, {});
    expect([...collectDescendantsDfs(['a'], info)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('dedupes diamond via visited set', () => {
    const info: AxisInfo = {
      parents: {}, allParents: {}, hasChildren: {},
      children: { A: ['B', 'C'], B: ['D'], C: ['D'] },
    };
    expect([...collectDescendantsDfs(['A'], info)].sort()).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('collectDirectChildren', () => {
  it('returns empty when no children', () => {
    const info = dummyAxis({}, {});
    expect([...collectDirectChildren(['x'], info)]).toEqual([]);
  });
  it('returns one-level children only, not transitive', () => {
    const info = dummyAxis({ b: 'a', c: 'a', d: 'b' }, {});
    const out = collectDirectChildren(['a'], info);
    expect(out.has('b')).toBe(true);
    expect(out.has('c')).toBe(true);
    expect(out.has('d')).toBe(false);
  });
  it('unions across multiple targets', () => {
    const info = dummyAxis({ x1: 'A', x2: 'A', y1: 'B' }, {});
    expect([...collectDirectChildren(['A', 'B'], info)].sort()).toEqual(['x1', 'x2', 'y1']);
  });
});

// ---------------------------------------------------------------------------
// Parity tests: shared operations.ts over buildCubeStructure match expected sets
// (Task 5 — ensures ctx handler migration produces same results as contextMenuPure)
// ---------------------------------------------------------------------------
describe('shared ops parity over buildCubeStructure', () => {
  // Tree:  P(level 2) → A(level 1) → x(level 0)
  //                   → B(level 0)
  // rowParents: { A:'P', x:'A', B:'P' }
  const m: any = {
    rowDims: ['D'],
    rowTuples: [['P'], ['A'], ['x'], ['B']],
    rowLevels: [[2], [1], [0], [0]],
    rowParents: [{ A: 'P', x: 'A', B: 'P' }],
    rowAllParents: [{}],
  };

  it('buildCubeStructure returns non-null for dim on row axis', () => {
    expect(buildCubeStructure(m, 'D', ['D'], [])).not.toBeNull();
  });

  it('buildCubeStructure returns null for unknown dim', () => {
    expect(buildCubeStructure(m, 'Z', ['D'], [])).toBeNull();
  });

  it('leaves(hier, P) returns level-0 descendants only (x and B)', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(leaves(s, 'P').sort()).toEqual(['B', 'x']);
  });

  it('leaves(hier, A) returns only x (level 0 child)', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(leaves(s, 'A')).toEqual(['x']);
  });

  it('children(hier, P) returns direct children only: A and B', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(children(s, 'P').sort()).toEqual(['A', 'B']);
  });

  it('children(hier, A) returns only x', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(children(s, 'A')).toEqual(['x']);
  });

  it('expandAllSet(hier, P) starts with P, has all descendants, parent before child', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    const res = expandAllSet(s, 'P');
    expect(res[0]).toBe('P');
    expect(res).toContain('A');
    expect(res).toContain('x');
    expect(res).toContain('B');
    // DFS: A before x (A is parent of x)
    expect(res.indexOf('A')).toBeLessThan(res.indexOf('x'));
  });

  it('allParents(hier, x) returns ancestors of x: A and P', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(allParents(s, 'x').sort()).toEqual(['A', 'P']);
  });

  it('allParents(hier, B) returns P only', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(allParents(s, 'B')).toEqual(['P']);
  });

  it('multi-target flatMap leaves dedupes correctly', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    // Both A and P would yield x as a leaf; dedup should yield unique set
    const lvs = Array.from(new Set(['A', 'P'].flatMap((t) => leaves(s, t))));
    expect(lvs.sort()).toEqual(['B', 'x']);
  });
});

// ---------------------------------------------------------------------------
// applyPendingDrillAction replay path — operations parity (Task 7)
// Verifies that each replay kind uses the correct shared operation via
// buildCubeStructure so the result is consistent with the live click handlers.
// Tree: P(lv2) → A(lv1), B(lv0);  A(lv1) → x(lv0)
// Uses rowAllParents:[{}] (empty, like Task-5 matrix) so parentOf chain is used
// for ancestor traversal — allParents BFS then reaches P via A.
// ---------------------------------------------------------------------------
describe('replay path ops parity over buildCubeStructure (Task 7)', () => {
  const m: any = {
    rowDims: ['D'],
    rowTuples: [['P'], ['A'], ['x'], ['B']],
    rowLevels: [[2], [1], [0], [0]],
    rowParents: [{ A: 'P', x: 'A', B: 'P' }],
    rowAllParents: [{}],
  };

  it('toggle (children) replay: direct children of P are A and B', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    const kids = Array.from(new Set(['P'].flatMap((t) => children(s, t))));
    expect(kids.sort()).toEqual(['A', 'B']);
  });

  it('toggle (children) replay: children of A is only x', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(children(s, 'A')).toEqual(['x']);
  });

  it('expandAll replay: expandAllSet(P) starts with P and includes all descendants', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    const expanded = Array.from(new Set(['P'].flatMap((t) => expandAllSet(s, t))));
    expect(expanded[0]).toBe('P');
    expect(expanded.sort()).toEqual(['A', 'B', 'P', 'x']);
  });

  it('showParents replay: parents(x) falls back to parentOf → returns A (direct parent)', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    // allParentsOf is empty → parents() uses parentOf['x'] = 'A'
    const parList = Array.from(new Set(['x'].flatMap((t) => parents(s, t))));
    expect(parList).toEqual(['A']);
  });

  it('showParents replay: parents(B) returns P only', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(parents(s, 'B')).toEqual(['P']);
  });

  it('showAllParents replay: allParents(x) BFS returns all ancestors (A and P)', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    const ancestors = Array.from(new Set(['x'].flatMap((t) => allParents(s, t))));
    expect(ancestors.sort()).toEqual(['A', 'P']);
  });

  it('showAllParents replay: allParents(A) returns P only', () => {
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(allParents(s, 'A')).toEqual(['P']);
  });

  it('buildCubeStructure returns null when matrix is null → fallback path', () => {
    expect(buildCubeStructure(null, 'D', ['D'], [])).toBeNull();
  });
});

/**
 * "Keep only" removes, it does not reorder. But the selection comes from
 * a `Set` in CLICK ORDER — whoever clicks from bottom to top used to
 * reverse the axis that way. That contradicts what is expected of the action, and
 * it also costs extra: a merely shrunk axis can be served by the webview from the
 * loaded matrix, a reordered one has to be rebuilt by the server.
 */
describe('keepOnlyNames', () => {
  it('keeps the axis order, no matter in which order the clicks happened', () => {
    const axis = ['Jan', 'Feb', 'Mrz', 'Apr'];
    expect(keepOnlyNames(axis, ['Mrz', 'Jan'])).toEqual(['Jan', 'Mrz']);
    expect(keepOnlyNames(axis, ['Jan', 'Mrz'])).toEqual(['Jan', 'Mrz']);
  });

  it('takes every occurrence when a name appears more than once on the axis', () => {
    // Axis positions are preserved — a name that appears twice stays
    // there twice. Anything else would be a hidden removal.
    expect(keepOnlyNames(['Total', 'A', 'Total'], ['Total'])).toEqual(['Total', 'Total']);
  });

  it('ignores names that are not on the axis at all', () => {
    expect(keepOnlyNames(['A', 'B'], ['B', 'Fremd'])).toEqual(['B']);
  });

  it('returns an empty list for an empty axis', () => {
    expect(keepOnlyNames([], ['A'])).toEqual([]);
  });
});
