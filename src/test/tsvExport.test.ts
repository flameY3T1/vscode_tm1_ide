import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCellset } from '../mdx/cellsetParser';
import { tableToTsv } from '../mdx/tsvExport';

function fx(name: string): any {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures/mdx', `${name}.json`), 'utf-8'));
}

describe('tableToTsv', () => {
  it('exports 2D table as TSV with header row and tab-separated values', () => {
    const table = parseCellset(fx('2d-with-title'));
    const tsv = tableToTsv(table);
    const lines = tsv.split('\n');

    // First line: blank corner + column headers
    const header = lines[0].split('\t');
    expect(header[0]).toBe('Fakultaet');   // row hierarchy in corner
    expect(header[1]).toBe('Plan_SWS');
    expect(header[2]).toBe('Ist_SWS');
    expect(header).toHaveLength(15);       // 1 corner + 14 cols

    // Second line: first row with Alle_Fakultaeten + 14 values
    const row0 = lines[1].split('\t');
    expect(row0[0]).toBe('Alle_Fakultaeten');
    expect(row0[1]).toBe('252,00');        // formatted value
    expect(row0[2]).toBe('250,00');
    expect(row0).toHaveLength(15);

    // Total lines = 1 header + 21 data rows
    expect(lines).toHaveLength(22);
  });

  it('crossjoin rows produce multiple header columns on the left', () => {
    const table = parseCellset(fx('crossjoin-rows'));
    const tsv = tableToTsv(table);
    const lines = tsv.split('\n');
    const header = lines[0].split('\t');
    expect(header[0]).toBe('Fakultaet');
    expect(header[1]).toBe('Version');
    expect(header[2]).toBe('Plan_SWS');

    const row0 = lines[1].split('\t');
    expect(row0[0]).toBe('Alle_Fakultaeten');
    expect(row0[1]).toBe('Plan');
    expect(row0[2]).toBe('252,00');
  });

  it('1D cellset (columns only) produces single data row with no row-header column', () => {
    const table = parseCellset(fx('1d-columns-only'));
    const tsv = tableToTsv(table);
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(2);  // 1 header + 1 data row
    const header = lines[0].split('\t');
    // No row hierarchies → corner cell is empty but we still need a blank
    // column so Excel parses the first data cell correctly. Actually with zero
    // row hierarchies the header starts directly with the first col header.
    expect(header[0]).toBe('Plan_SWS');
    expect(header).toHaveLength(14);

    const row = lines[1].split('\t');
    expect(row[0]).toBe('252,00');
    expect(row).toHaveLength(14);
  });

  it('null cell value becomes empty string in TSV', () => {
    const table = {
      colHeaders: [['A'], ['B']],
      colHierarchies: ['Kz'],
      rowHeaders: [['R1']],
      rowHierarchies: ['Dim'],
      titleHeaders: [],
      cells: [[
        { value: null, formatted: '' },
        { value: 42, formatted: '42,00' },
      ]],
      dims: { cols: 2, rows: 1 },
    };
    const tsv = tableToTsv(table);
    const rows = tsv.split('\n');
    expect(rows[1].split('\t')).toEqual(['R1', '', '42,00']);
  });

  it('escapes embedded tabs and newlines in cell content', () => {
    const table = {
      colHeaders: [['A']],
      colHierarchies: ['X'],
      rowHeaders: [['row\twith\ttabs']],
      rowHierarchies: ['Dim'],
      titleHeaders: [],
      cells: [[{ value: 'line1\nline2', formatted: 'line1\nline2' }]],
      dims: { cols: 1, rows: 1 },
    };
    const tsv = tableToTsv(table);
    // Embedded tabs/newlines replaced with space
    expect(tsv).not.toContain('row\twith');
    expect(tsv).not.toContain('line1\nline2');
  });

  it('stacked column hierarchies produce multiple header rows', () => {
    const table = {
      colHeaders: [['Jan', '2024'], ['Feb', '2024']],
      colHierarchies: ['Monat', 'Jahr'],
      rowHeaders: [['Alle']],
      rowHierarchies: ['Fak'],
      titleHeaders: [],
      cells: [[{ value: 1, formatted: '1' }, { value: 2, formatted: '2' }]],
      dims: { cols: 2, rows: 1 },
    };
    const tsv = tableToTsv(table);
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(3);  // 2 header rows + 1 data
    expect(lines[0].split('\t')).toEqual(['Fak', 'Jan', 'Feb']);
    expect(lines[1].split('\t')).toEqual(['', '2024', '2024']);
    expect(lines[2].split('\t')).toEqual(['Alle', '1', '2']);
  });

  it('empty table produces empty string', () => {
    const table = {
      colHeaders: [],
      colHierarchies: [],
      rowHeaders: [],
      rowHierarchies: [],
      titleHeaders: [],
      cells: [],
      dims: { cols: 0, rows: 0 },
    };
    const tsv = tableToTsv(table);
    expect(tsv).toBe('');
  });
});
