/**
 * Read / write the simulator's expected & actual output as CSV.
 *
 * CSV format:
 *   <cube>,<e1>,<e2>,...,<eN>,<value>
 * The last column is always the value (number for CellPutN/Increment,
 * string for CellPutS — type inferred per row).
 *
 * Also accepts the existing JSONL row-format used by the server-side
 * framework so users can mix both during transition.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Value } from '../types';
import type { AggregatedCell } from '../../tiTestFramework/log/logAggregator';
import { cellKey } from '../../tiTestFramework/log/logSchema';
import { readJsonlAll } from '../../tiTestFramework/storage/jsonlIo';
import { parseCsvLine, quotedLineDelim } from '../../tiTestFramework/log/logParser';

export type ExpectedCell = {
  cube: string;
  coord: string[];
  value: Value;
};

function detectDelimiter(lines: string[]): string {
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    // Any DatasourceASCIIDelimiter, see quotedLineDelim.
    const quoted = quotedLineDelim(line);
    if (quoted !== null) return quoted;
    let semi = 0;
    let comma = 0;
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') {
          i++;
          continue;
        }
        inQuote = !inQuote;
        continue;
      }
      if (inQuote) continue;
      if (c === ';') semi++;
      else if (c === ',') comma++;
    }
    return semi > comma ? ';' : ',';
  }
  return ',';
}

function parseNumericCell(t: string): number | undefined {
  if (t === '') return undefined;
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  if (t.indexOf(',') !== -1 && t.indexOf(',') === t.lastIndexOf(',')) {
    const swapped = Number(t.replace(',', '.'));
    if (Number.isFinite(swapped)) return swapped;
  }
  return undefined;
}

function escapeCsvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function parseExpectedCsv(content: string): ExpectedCell[] {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.length > 0)
    .filter((l) => !l.trimStart().startsWith('#'));
  if (lines.length === 0) return [];

  const delim = detectDelimiter(lines);
  const cells: ExpectedCell[] = [];
  let start = 0;
  const first = parseCsvLine(lines[0], delim, false);
  if (first.length >= 2 && first[first.length - 1].trim().toLowerCase() === 'value') {
    start = 1;
  }

  for (let i = start; i < lines.length; i++) {
    const f = parseCsvLine(lines[i], delim, false);
    if (f.length < 2) continue;
    const cube = f[0];
    const valueRaw = f[f.length - 1].trim();
    const coord = f.slice(1, -1);
    const n = parseNumericCell(valueRaw);
    const value: Value = n !== undefined ? n : valueRaw;
    cells.push({ cube, coord, value });
  }
  return cells;
}

export function expectedCellsToCsv(cells: ExpectedCell[]): string {
  if (cells.length === 0) return '';
  return (
    cells
      .map((c) =>
        [c.cube, ...c.coord, typeof c.value === 'number' ? String(c.value) : c.value]
          .map(escapeCsvField)
          .join(','),
      )
      .join('\n') + '\n'
  );
}

export async function readExpectedOutput(testFolder: string): Promise<ExpectedCell[]> {
  // Resolve from new data/ layout first, then legacy expected/ for back-compat.
  for (const sub of ['data', 'expected'] as const) {
    const csvPath = path.join(testFolder, sub, 'output.csv');
    if (await fileExists(csvPath)) {
      const content = await fs.readFile(csvPath, 'utf8');
      return parseExpectedCsv(content);
    }
    const jsonlPath = path.join(testFolder, sub, 'output.jsonl');
    if (await fileExists(jsonlPath)) {
      type Row = { cube: string; coord: string[]; value: Value };
      const rows = await readJsonlAll<Row>(jsonlPath);
      return rows.map((r) => ({ cube: r.cube, coord: r.coord, value: r.value }));
    }
  }
  return [];
}

export function expectedToAggregated(cells: ExpectedCell[]): Map<string, AggregatedCell> {
  const out = new Map<string, AggregatedCell>();
  for (const c of cells) {
    out.set(cellKey(c.cube, c.coord), {
      cube: c.cube,
      coord: c.coord,
      value: c.value,
      hasIncrement: false,
      lastOp: typeof c.value === 'string' ? 'CellPutS' : 'CellPutN',
    });
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
