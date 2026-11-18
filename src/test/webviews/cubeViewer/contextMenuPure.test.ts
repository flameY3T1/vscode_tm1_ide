import { describe, it, expect } from 'vitest';
import {
  buildAxisInfo,
  collectParentsUnion,
  eligibleCCells,
  collectAncestorsRootFirst,
  collectDescendantsDfs,
  collectDirectChildren,
  keepOnlyNames,
  shownAxisNames,
  insertAboveFirstTarget,
  type AxisInfo,
  type MatrixLike,
} from '../../../webviewClient/cubeViewerMonaco/contextMenuPure';

describe('insertAboveFirstTarget', () => {
  it('puts the parents directly above the first clicked element', () => {
    expect(insertAboveFirstTarget(['2023', '2024', '2025'], ['2024'], ['Alle'])).toEqual(['2023', 'Alle', '2024', '2025']);
  });

  it('several ancestors keep their given order above the element', () => {
    // Click test 2026-11-13: "Show all parents" appended the C element BELOW.
    expect(insertAboveFirstTarget(['2024'], ['2024'], ['Total', 'Alle'])).toEqual(['Total', 'Alle', '2024']);
  });

  it('a target that is not on the axis puts the parents first', () => {
    expect(insertAboveFirstTarget(['a'], ['x'], ['p'])).toEqual(['p', 'a']);
  });
});

describe('shownAxisNames', () => {
  // Click test 2026-11-13: all years loaded, "Keep only" one (local, no
  // reload), "Show parent" - every year came back, because the base list was
  // read from the matrix, which still holds the hidden rows.
  const matrix = () => ['2023', '2024', '2025'];

  it('an element selection wins over the matrix', () => {
    expect(shownAxisNames({ kind: 'elements', names: ['2024'] }, matrix)).toEqual(['2024']);
  });

  it('without an element selection the matrix decides', () => {
    expect(shownAxisNames(undefined, matrix)).toEqual(['2023', '2024', '2025']);
    expect(shownAxisNames({ kind: 'all' }, matrix)).toEqual(['2023', '2024', '2025']);
  });
});

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
  // The first-parent map names ONE parent per element. Built from it alone, C was
  // missing under B - a replayed drill on B then showed no children.
  it('lists a multi-parent child under every parent, not only the first', () => {
    const m: MatrixLike = {
      rowDims: ['D'],
      rowParents: [{ C: 'A', X: 'A' }],
      rowAllParents: [{ C: ['A', 'B'] }],
    };
    const info = buildAxisInfo(m, 'D', [], [])!;
    expect(info.children.B).toEqual(['C']);
    expect(info.children.A.sort()).toEqual(['C', 'X']);
    expect([...collectDirectChildren(['B'], info)]).toEqual(['C']);
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

describe('collectAncestorsRootFirst', () => {
  it('returns empty for no ancestors', () => {
    const info = dummyAxis({}, {});
    expect([...collectAncestorsRootFirst(['leaf'], info)]).toEqual([]);
  });
  it('walks single-parent chain', () => {
    const info = dummyAxis({ a: 'b', b: 'c' }, {});
    expect([...collectAncestorsRootFirst(['a'], info)].sort()).toEqual(['b', 'c']);
  });
  it('walks multi-parent ancestors via allParents', () => {
    const info = dummyAxis({}, { a: ['p1', 'p2'], p1: ['gp'], p2: ['gp'] });
    expect([...collectAncestorsRootFirst(['a'], info)].sort()).toEqual(['gp', 'p1', 'p2']);
  });
  it('safe on cyclic allParents input', () => {
    const info = dummyAxis({}, { A: ['B'], B: ['A'] });
    expect([...collectAncestorsRootFirst(['A'], info)].sort()).toEqual(['A', 'B']);
  });
  it('does NOT include targets themselves unless re-reached via cycle', () => {
    const info = dummyAxis({ a: 'b', b: 'c' }, {});
    const out = collectAncestorsRootFirst(['a'], info);
    expect(out.includes('a')).toBe(false);
  });
  it('puts a root above its child when it is also a direct parent of the target', () => {
    const edges = { Leaf: ['Root', 'Parent'], Parent: ['Root'] };
    expect(collectAncestorsRootFirst(['Leaf'], dummyAxis({}, edges))).toEqual(['Root', 'Parent']);
    expect(collectAncestorsRootFirst(['Leaf'], dummyAxis({}, { ...edges, Leaf: ['Parent', 'Root'] }))).toEqual(['Root', 'Parent']);
  });
  it('keeps every ancestor above its descendants over parent paths of different length, for several targets', () => {
    const info = dummyAxis({}, { Leaf: ['D', 'A'], Leaf2: ['B'], A: ['B'], B: ['R'], D: ['R'] });
    const out = collectAncestorsRootFirst(['Leaf', 'Leaf2'], info);
    expect([...out].sort()).toEqual(['A', 'B', 'D', 'R']);
    expect(out.indexOf('R')).toBeLessThan(out.indexOf('B'));
    expect(out.indexOf('R')).toBeLessThan(out.indexOf('D'));
    expect(out.indexOf('B')).toBeLessThan(out.indexOf('A'));
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
