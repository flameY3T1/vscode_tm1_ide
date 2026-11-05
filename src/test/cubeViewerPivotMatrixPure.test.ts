import { describe, it, expect } from 'vitest';
import { pivotMatrixLocal, MAX_PIVOT_PAIRS } from '../webviewClient/cubeViewerMonaco/pivotMatrixPure';
import type { MatrixData } from '../webviewClient/cubeViewerMonaco/state';

/**
 * Basic layout: rows carry D1 (A, B) × D2 (X, Y), columns carry D3 (P, Q).
 * Every cell is named after its old place, so that a test can read off the value
 * where it comes from.
 */
function baseMatrix(): MatrixData {
  const rowTuples = [['A', 'X'], ['A', 'Y'], ['B', 'X'], ['B', 'Y']];
  const colTuples = [['P'], ['Q']];
  const values: Record<string, string> = {};
  for (let ri = 0; ri < rowTuples.length; ri++) {
    for (let ci = 0; ci < colTuples.length; ci++) { values[`${ri},${ci}`] = `r${ri}c${ci}`; }
  }
  return {
    rowElements: rowTuples.map((t) => t.join(' / ')),
    colElements: colTuples.map((t) => t.join(' / ')),
    values,
    rowTuples, colTuples,
    rowDims: ['D1', 'D2'], colDims: ['D3'],
    numCols: 2,
  };
}

describe('pivotMatrixLocal — reordering within one axis', () => {
  it('turns the nesting of the rows around and takes the values along', () => {
    const next = pivotMatrixLocal({
      matrix: baseMatrix(),
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D2', 'D1'], nextColDims: ['D3'],
      titleMembers: {},
    });
    expect(next).not.toBeNull();
    expect(next!.rowDims).toEqual(['D2', 'D1']);
    expect(next!.rowTuples).toEqual([['X', 'A'], ['X', 'B'], ['Y', 'A'], ['Y', 'B']]);
    expect(next!.rowElements).toEqual(['X / A', 'X / B', 'Y / A', 'Y / B']);
    // [X,A] was row 0, [X,B] was row 2, [Y,A] row 1, [Y,B] row 3.
    expect(next!.values['0,0']).toBe('r0c0');
    expect(next!.values['1,0']).toBe('r2c0');
    expect(next!.values['2,0']).toBe('r1c0');
    expect(next!.values['3,1']).toBe('r3c1');
    expect(next!.numCols).toBe(2);
  });
});

describe('pivotMatrixLocal — between the axes', () => {
  it('moves a row dimension onto the columns', () => {
    const next = pivotMatrixLocal({
      matrix: baseMatrix(),
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1'], nextColDims: ['D3', 'D2'],
      titleMembers: {},
    });
    expect(next).not.toBeNull();
    expect(next!.rowTuples).toEqual([['A'], ['B']]);
    expect(next!.colTuples).toEqual([['P', 'X'], ['P', 'Y'], ['Q', 'X'], ['Q', 'Y']]);
    expect(next!.numCols).toBe(4);
    expect(next!.values['0,0']).toBe('r0c0'); // A,P,X
    expect(next!.values['0,1']).toBe('r1c0'); // A,P,Y
    expect(next!.values['0,2']).toBe('r0c1'); // A,Q,X
    expect(next!.values['0,3']).toBe('r1c1'); // A,Q,Y
    expect(next!.values['1,0']).toBe('r2c0'); // B,P,X
    expect(next!.values['1,3']).toBe('r3c1'); // B,Q,Y
  });

  it('moves a column dimension onto the rows', () => {
    const rowTuples = [['A'], ['B']];
    const colTuples = [['P', 'M'], ['P', 'N'], ['Q', 'M'], ['Q', 'N']];
    const values: Record<string, string> = {};
    for (let ri = 0; ri < 2; ri++) {
      for (let ci = 0; ci < 4; ci++) { values[`${ri},${ci}`] = `r${ri}c${ci}`; }
    }
    const m: MatrixData = {
      rowElements: ['A', 'B'], colElements: colTuples.map((t) => t.join(' / ')),
      values, rowTuples, colTuples,
      rowDims: ['D1'], colDims: ['D3', 'D4'], numCols: 4,
    };
    const next = pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1'], oldColDims: ['D3', 'D4'],
      nextRowDims: ['D1', 'D4'], nextColDims: ['D3'],
      titleMembers: {},
    });
    expect(next).not.toBeNull();
    expect(next!.rowTuples).toEqual([['A', 'M'], ['A', 'N'], ['B', 'M'], ['B', 'N']]);
    expect(next!.colTuples).toEqual([['P'], ['Q']]);
    expect(next!.values['0,0']).toBe('r0c0'); // A,M,P
    expect(next!.values['1,0']).toBe('r0c1'); // A,N,P
    expect(next!.values['2,0']).toBe('r1c0'); // B,M,P
    expect(next!.values['0,1']).toBe('r0c2'); // A,M,Q
    expect(next!.values['3,1']).toBe('r1c3'); // B,N,Q
  });
});

describe('pivotMatrixLocal — into the context', () => {
  it('cuts down to the fixed element and drops the rest', () => {
    const next = pivotMatrixLocal({
      matrix: baseMatrix(),
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1'], nextColDims: ['D3'],
      titleMembers: { D2: 'X' },
    });
    expect(next).not.toBeNull();
    expect(next!.rowTuples).toEqual([['A'], ['B']]);
    expect(next!.titleAssignments).toEqual({ D2: 'X' });
    expect(next!.values['0,0']).toBe('r0c0'); // A,X,P
    expect(next!.values['1,0']).toBe('r2c0'); // B,X,P
    expect(next!.values['0,1']).toBe('r0c1'); // A,X,Q
    expect(next!.values['1,1']).toBe('r2c1'); // B,X,Q
    // The Y cells are gone, the grid has exactly 2×2 values.
    expect(Object.keys(next!.values).length).toBe(4);
  });
});

describe('pivotMatrixLocal — gaps from suppressed empty rows', () => {
  it('reorders across a missing combination', () => {
    const rowTuples = [['A', 'X'], ['B', 'X'], ['B', 'Y']]; // [A,Y] was empty
    const colTuples = [['P']];
    const values: Record<string, string> = { '0,0': 'r0c0', '1,0': 'r1c0', '2,0': 'r2c0' };
    const m: MatrixData = {
      rowElements: rowTuples.map((t) => t.join(' / ')), colElements: ['P'],
      values, rowTuples, colTuples, rowDims: ['D1', 'D2'], colDims: ['D3'], numCols: 1,
    };
    const next = pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D2', 'D1'], nextColDims: ['D3'],
      titleMembers: {},
    });
    expect(next).not.toBeNull();
    expect(next!.rowTuples).toEqual([['X', 'A'], ['X', 'B'], ['Y', 'B']]);
    expect(next!.values['0,0']).toBe('r0c0');
    expect(next!.values['1,0']).toBe('r1c0');
    expect(next!.values['2,0']).toBe('r2c0');
  });
});

describe('pivotMatrixLocal — carried-along data', () => {
  it('carries levels and parent maps to the new dimension position', () => {
    const m = baseMatrix();
    // Levels per row, indexed [rowIdx][dimIdx]: D1 A=1 B=0, D2 X=2 Y=2.
    m.rowLevels = [[1, 2], [1, 2], [0, 2], [0, 2]];
    m.colLevels = [[3], [3]];
    m.rowParents = [{ A: 'Top1' }, { X: 'Top2' }];
    m.colParents = [{ P: 'Top3' }];
    m.rowAllParents = [{ A: ['Top1'] }, { X: ['Top2'] }];
    m.colAllParents = [{ P: ['Top3'] }];

    const swapped = pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D2', 'D1'], nextColDims: ['D3'],
      titleMembers: {},
    });
    expect(swapped!.rowParents).toEqual([{ X: 'Top2' }, { A: 'Top1' }]);
    expect(swapped!.rowAllParents).toEqual([{ X: ['Top2'] }, { A: ['Top1'] }]);
    // Row 0 is now [X, A]: level of X, then level of A.
    expect(swapped!.rowLevels?.[0]).toEqual([2, 1]);
    expect(swapped!.rowLevels?.[1]).toEqual([2, 0]); // [X, B]

    const moved = pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1'], nextColDims: ['D3', 'D2'],
      titleMembers: {},
    });
    expect(moved!.rowParents).toEqual([{ A: 'Top1' }]);
    expect(moved!.colParents).toEqual([{ P: 'Top3' }, { X: 'Top2' }]);
    expect(moved!.colLevels?.[0]).toEqual([3, 2]); // [P, X]
  });

  it('carries the collapse-triangle set to the new dimension position', () => {
    // Since the scoping, `hasChildren` comes from the host and can NO longer be
    // derived from the parent maps. If it stayed behind on a local axis change,
    // all triangles would disappear after every drag — silently.
    const m = baseMatrix();
    m.rowHasChildren = [{ A: true }, { X: true }];
    m.colHasChildren = [{ P: true }];

    const swapped = pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D2', 'D1'], nextColDims: ['D3'],
      titleMembers: {},
    });
    expect(swapped!.rowHasChildren).toEqual([{ X: true }, { A: true }]);
    expect(swapped!.colHasChildren).toEqual([{ P: true }]);

    const moved = pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1'], nextColDims: ['D3', 'D2'],
      titleMembers: {},
    });
    expect(moved!.rowHasChildren).toEqual([{ A: true }]);
    expect(moved!.colHasChildren).toEqual([{ P: true }, { X: true }]);
  });
});

describe('pivotMatrixLocal — when the server has to step in', () => {
  it('returns null when a dimension from the context is to go onto an axis', () => {
    expect(pivotMatrixLocal({
      matrix: baseMatrix(),
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1', 'D2', 'D9'], nextColDims: ['D3'],
      titleMembers: {},
    })).toBeNull();
  });

  it('returns null in paging mode', () => {
    const m = baseMatrix();
    m.paged = true;
    expect(pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D2', 'D1'], nextColDims: ['D3'],
      titleMembers: {},
    })).toBeNull();
  });

  it('returns null when an old axis dimension lands nowhere', () => {
    expect(pivotMatrixLocal({
      matrix: baseMatrix(),
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1'], nextColDims: ['D3'],
      titleMembers: {},
    })).toBeNull();
  });

  it('returns null when an axis would become empty in the process', () => {
    expect(pivotMatrixLocal({
      matrix: baseMatrix(),
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D1', 'D2', 'D3'], nextColDims: [],
      titleMembers: {},
    })).toBeNull();
  });

  it('returns null when an axis cannot be explained as a name sequence', () => {
    const rowTuples = [['A', 'X'], ['A', 'Y'], ['B', 'Y'], ['B', 'X']]; // X before Y, then Y before X
    const values: Record<string, string> = {};
    for (let ri = 0; ri < 4; ri++) { values[`${ri},0`] = `r${ri}c0`; }
    const m: MatrixData = {
      rowElements: rowTuples.map((t) => t.join(' / ')), colElements: ['P'],
      values, rowTuples, colTuples: [['P']], rowDims: ['D1', 'D2'], colDims: ['D3'], numCols: 1,
    };
    expect(pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1', 'D2'], oldColDims: ['D3'],
      nextRowDims: ['D2', 'D1'], nextColDims: ['D3'],
      titleMembers: {},
    })).toBeNull();
  });

  it('returns null when too many pairs would have to be gone through', () => {
    const rows = 1000;
    const cols = Math.ceil(MAX_PIVOT_PAIRS / rows) + 1;
    const rowTuples = Array.from({ length: rows }, (_, i) => [`R${i}`]);
    const colTuples = Array.from({ length: cols }, (_, i) => [`C${i}`]);
    const m: MatrixData = {
      rowElements: rowTuples.map((t) => t[0]), colElements: colTuples.map((t) => t[0]),
      values: {}, rowTuples, colTuples, rowDims: ['D1'], colDims: ['D3'], numCols: cols,
    };
    expect(pivotMatrixLocal({
      matrix: m,
      oldRowDims: ['D1'], oldColDims: ['D3'],
      nextRowDims: ['D3'], nextColDims: ['D1'],
      titleMembers: {},
    })).toBeNull();
  });
});
