import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseCsv, readCsv, rowBindings } from '../../../tiSimulator/source/csvSource';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-source-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('parseCsv', () => {
  it('keeps a standard "" escape before the delimiter inside the field', () => {
    expect(parseCsv('"a"",b",42\n').rows).toEqual([['a",b', 42]]);
    expect(parseCsv('"a"";b";42\n').rows).toEqual([['a";b', 42]]);
  });

  it('parses simple all-numeric data without header', () => {
    const r = parseCsv('1,2,3\n4,5,6\n');
    expect(r.header).toBeUndefined();
    expect(r.columnTypes).toEqual(['Numeric', 'Numeric', 'Numeric']);
    expect(r.rows).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('detects header from non-numeric first row', () => {
    const r = parseCsv('Year,Region,Sales\n2026,EU,1000\n');
    expect(r.header).toEqual(['Year', 'Region', 'Sales']);
    expect(r.columnTypes).toEqual(['Numeric', 'String', 'Numeric']);
    expect(r.rows).toEqual([[2026, 'EU', 1000]]);
  });

  it('handles quoted fields with commas (with explicit numeric → header detected)', () => {
    const r = parseCsv(`name,note,id\nwidget,"hello, world",42\n`);
    expect(r.header).toEqual(['name', 'note', 'id']);
    expect(r.rows[0]).toEqual(['widget', 'hello, world', 42]);
  });

  it('handles doubled-quote escape on row 0 (treated as data when no body numeric)', () => {
    const r = parseCsv(`"it""s"\n"foo"\n`);
    expect(r.rows[0]).toEqual([`it"s`]);
    expect(r.rows[1]).toEqual([`foo`]);
  });

  it('empty cells in numeric column → 0', () => {
    const r = parseCsv('1,2\n,5\n3,4\n');
    expect(r.rows[1]).toEqual([0, 5]);
  });

  it('returns empty for empty input', () => {
    expect(parseCsv('').rows).toEqual([]);
  });

  it('readCsv reads from disk', async () => {
    const f = path.join(tmp, 'src.csv');
    await fs.writeFile(f, 'Year,Sales\n2026,1000\n2027,2000\n', 'utf8');
    const r = await readCsv(f);
    expect(r.rows).toEqual([
      [2026, 1000],
      [2027, 2000],
    ]);
  });

  it('readCsv decodes a Windows-1252 export (SetInputCharacterSet source) and UTF-8 alike', async () => {
    const f1252 = path.join(tmp, 'w.csv');
    const fUtf8 = path.join(tmp, 'u.csv');
    await fs.writeFile(f1252, Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a])); // "Müller" in 1252
    await fs.writeFile(fUtf8, 'Müller\n', 'utf8');
    expect((await readCsv(f1252)).rows).toEqual([['Müller']]);
    expect((await readCsv(fUtf8)).rows).toEqual([['Müller']]);
  });

  it('rowBindings creates vdim_* + v* aliases', () => {
    const b = rowBindings(['A', 'B', 1]);
    expect(b.vdim_1).toBe('A');
    expect(b.vdim_2).toBe('B');
    expect(b.vdim_3).toBe(1);
    expect(b.v1).toBe('A');
  });
});
