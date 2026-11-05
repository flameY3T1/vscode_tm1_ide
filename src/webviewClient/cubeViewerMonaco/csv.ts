/**
 * CSV builder for the visible matrix. Semicolon-separated, no quoting (matches
 * the inline-template behavior 1:1). Row/Col dim labels are joined with `+`.
 */

import { state } from './state';
import type { MatrixData } from './state';

export function buildCsv(matrix: MatrixData): string {
  const { rowElements, colElements, values } = matrix;
  const sep = ';';
  const rLabel = (matrix.rowDims?.length ? matrix.rowDims : state.rowDims).join('+');
  const cLabel = (matrix.colDims?.length ? matrix.colDims : state.colDims).join('+');
  const lines: string[] = [];
  lines.push([`${rLabel}\\\\${cLabel}`, ...colElements].join(sep));
  rowElements.forEach((row, ri) => {
    const cells = colElements.map((_, ci) => {
      const v = values[`${ri},${ci}`];
      return v == null ? '' : String(v);
    });
    lines.push([row, ...cells].join(sep));
  });
  return lines.join('\n');
}
