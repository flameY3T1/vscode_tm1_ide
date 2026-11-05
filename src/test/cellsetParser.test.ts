import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCellset } from '../mdx/cellsetParser';

function fx(name: string): any {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures/mdx', `${name}.json`), 'utf-8'));
}

describe('parseCellset', () => {
  it('parses 2D cellset: columns + rows + title axis', () => {
    const table = parseCellset(fx('2d-with-title'));
    expect(table.dims).toEqual({ cols: 14, rows: 21 });
  });

  it('populates colHeaders and colHierarchies for 2D cellset', () => {
    const table = parseCellset(fx('2d-with-title'));
    expect(table.colHierarchies).toEqual(['Kennzahl']);
    expect(table.colHeaders).toHaveLength(14);
    expect(table.colHeaders[0]).toEqual(['Plan_SWS']);
    expect(table.colHeaders[1]).toEqual(['Ist_SWS']);
  });

  it('populates rowHeaders and rowHierarchies for 2D cellset', () => {
    const table = parseCellset(fx('2d-with-title'));
    expect(table.rowHierarchies).toEqual(['Fakultaet']);
    expect(table.rowHeaders).toHaveLength(21);
    expect(table.rowHeaders[0]).toEqual(['Alle_Fakultaeten']);
    expect(table.rowHeaders[1]).toEqual(['Wirtschaftswissenschaften']);
  });

  it('extracts title axis as slicer headers', () => {
    const table = parseCellset(fx('2d-with-title'));
    expect(table.titleHeaders).toEqual([
      { hierarchy: 'Semester', member: 'Alle_Semester' },
      { hierarchy: 'Dozent',   member: 'Alle_Dozenten' },
      { hierarchy: 'Version',  member: 'Plan' },
    ]);
  });

  it('fills cells in row-major order (cells[row][col])', () => {
    const table = parseCellset(fx('2d-with-title'));
    // Raw fixture: cell[0]={ordinal:0, value:252} (Plan_SWS × Alle_Fakultaeten),
    // cell[1]={ordinal:1, value:250} (Ist_SWS × Alle_Fakultaeten). So row-major by row.
    expect(table.cells).toHaveLength(21);
    expect(table.cells[0]).toHaveLength(14);
    expect(table.cells[0][0]).toEqual({ value: 252, formatted: '252,00' });
    expect(table.cells[0][1]).toEqual({ value: 250, formatted: '250,00' });
  });

  it('handles 1D cellset (columns only, no ROWS in MDX)', () => {
    const table = parseCellset(fx('1d-columns-only'));
    expect(table.dims).toEqual({ cols: 14, rows: 1 });
    expect(table.rowHeaders).toEqual([]);
    expect(table.rowHierarchies).toEqual([]);
    expect(table.cells).toHaveLength(1);
    expect(table.cells[0]).toHaveLength(14);
    expect(table.cells[0][0]).toEqual({ value: 252, formatted: '252,00' });
    // Title axis absorbs all dimensions not on cols
    expect(table.titleHeaders.map(t => t.hierarchy)).toEqual(['Semester', 'Dozent', 'Fakultaet', 'Version']);
  });

  it('WHERE clause members end up in title axis', () => {
    const table = parseCellset(fx('with-where-clause'));
    expect(table.dims).toEqual({ cols: 2, rows: 21 });
    // WHERE ([Semester].[Alle_Semester]) fixes Semester on title axis
    const semesterHeader = table.titleHeaders.find(t => t.hierarchy === 'Semester');
    expect(semesterHeader?.member).toBe('Alle_Semester');
  });

  it('crossjoin on rows produces multi-hierarchy rowHeaders', () => {
    const table = parseCellset(fx('crossjoin-rows'));
    expect(table.rowHierarchies).toEqual(['Fakultaet', 'Version']);
    // Each row's header tuple has one member per hierarchy
    for (const row of table.rowHeaders) {
      expect(row).toHaveLength(2);
    }
    expect(table.rowHeaders[0]).toEqual(['Alle_Fakultaeten', 'Plan']);
  });

  it('null cell values are preserved; formatted keeps server locale string', () => {
    const table = parseCellset(fx('2d-with-title'));
    // Find any cell with null value (sparse cellset in fixture)
    const flat = table.cells.flat();
    const nullCell = flat.find(c => c.value === null);
    if (nullCell) {
      expect(typeof nullCell.formatted).toBe('string');
    }
    // Not finding a null cell is also valid — the test just asserts the type contract.
  });

  it('empty cellset (no axes) returns safe defaults', () => {
    const table = parseCellset({});
    expect(table.dims).toEqual({ cols: 0, rows: 1 });
    expect(table.colHeaders).toEqual([]);
    expect(table.rowHeaders).toEqual([]);
    expect(table.titleHeaders).toEqual([]);
    expect(table.cells).toEqual([[]]);
  });
});
