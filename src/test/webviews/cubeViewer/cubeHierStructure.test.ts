import { describe, it, expect } from 'vitest';
import { buildCubeStructure } from '../../../webviewClient/cubeViewerMonaco/cubeHierStructure';

describe('buildCubeStructure', () => {
  it('builds childrenOf + per-element level from a row-axis matrix', () => {
    const matrix = {
      rowDims: ['D'], colDims: [],
      rowTuples: [['P'], ['A'], ['x']],
      rowLevels: [[2], [1], [0]],
      rowParents: [{ A: 'P', x: 'A' }],
      rowAllParents: [{}],
    } as any;
    const s = buildCubeStructure(matrix, 'D', ['D'], []);
    expect(s).not.toBeNull();
    expect(s!.childrenOf['P']).toEqual(['A']);
    expect(s!.childrenOf['A']).toEqual(['x']);
    expect(s!.meta['x'].level).toBe(0);
    expect(s!.meta['P'].level).toBe(2);
  });

  it('returns null for an unknown dim', () => {
    expect(buildCubeStructure({ rowDims: ['D'] } as any, 'Z', ['D'], [])).toBeNull();
  });

  it('builds meta.level from a col-axis matrix', () => {
    const matrix = {
      rowDims: [], colDims: ['C'],
      colTuples: [['X'], ['Y']],
      colLevels: [[1], [0]],
      colParents: [{ Y: 'X' }],
      colAllParents: [{}],
    } as any;
    const s = buildCubeStructure(matrix, 'C', [], ['C']);
    expect(s).not.toBeNull();
    expect(s!.meta['X'].level).toBe(1);
    expect(s!.meta['Y'].level).toBe(0);
    expect(s!.childrenOf['X']).toEqual(['Y']);
  });
});
