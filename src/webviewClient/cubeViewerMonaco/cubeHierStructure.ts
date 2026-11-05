import type { HierarchyStructure } from '../_shared/hierarchy/types';
import { buildAxisInfo } from './contextMenuPure';
import type { MatrixData } from './state';
import { nameMap } from '../../utils/nameMapPure';

export function buildCubeStructure(
  matrix: MatrixData | null | undefined,
  dim: string,
  rowDims: string[],
  colDims: string[]
): HierarchyStructure | null {
  if (!matrix) {
    return null;
  }

  if (!rowDims.includes(dim) && !colDims.includes(dim)) {
    return null;
  }

  const axisInfo = buildAxisInfo(matrix, dim, rowDims, colDims);
  if (!axisInfo) {
    return null;
  }

  const isRowDim = rowDims.includes(dim);
  const dimIndex = isRowDim ? rowDims.indexOf(dim) : colDims.indexOf(dim);
  const tuples = isRowDim ? matrix.rowTuples : matrix.colTuples;
  const levels = isRowDim ? matrix.rowLevels : matrix.colLevels;

  if (!tuples || !levels) {
    return null;
  }

  const meta = nameMap<{ name: string; type: string; level: number }>();
  for (let i = 0; i < tuples.length; i++) {
    const elemName = tuples[i][dimIndex];
    const level = levels[i]?.[dimIndex] ?? 0;
    meta[elemName] = { name: elemName, type: '', level };
  }

  const ensure = (n: string): void => { if (!meta[n]) { meta[n] = { name: n, type: '', level: 0 }; } };
  Object.keys(axisInfo.children).forEach((p) => { ensure(p); axisInfo.children[p].forEach(ensure); });

  return {
    childrenOf: axisInfo.children || {},
    parentOf: axisInfo.parents || {},
    allParentsOf: axisInfo.allParents || {},
    meta,
  };
}
