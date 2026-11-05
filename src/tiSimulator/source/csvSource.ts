/**
 * Tiny CSV reader for source-data fixtures. Supports the same RFC-4180
 * subset as the existing log-parser (double-quoted fields, "" embedded-quote
 * escape) but on `,`-separated input.
 *
 * Header detection: if every cell of row 0 is a non-numeric, identifier-ish
 * string, treat row 0 as a header (skip it for data); else row 0 is data.
 *
 * Per-column type inference: a column is numeric iff every non-empty cell
 * parses as a finite Number; else string. Numeric columns yield `number`
 * cells, string columns yield `string`.
 */

import { promises as fs } from 'node:fs';
import type { Value } from '../types';
import { parseCsvLine, quotedLineDelim } from '../../tiTestFramework/log/logParser';
import { decodeServerText } from '../../utils/serverText';

export type SourceRow = Value[];

export type SourceTable = {
  header?: string[];
  rows: SourceRow[];
  columnTypes: ('Numeric' | 'String')[];
};

/** Detect delimiter from the first non-empty line: the one after a leading
 *  quoted field (any `DatasourceASCIIDelimiter`), else prefer `;` if it occurs
 *  more often than `,` (TM1 German-locale exports use `;`). */
function detectDelimiter(lines: string[]): string {
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
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

/**
 * Header detection: only treat row 0 as header when EVERY column in row 0
 * is non-numeric AND every column in some later row contains a numeric.
 * Mixed-type rows like ['Element_1','Umsatz','1'] (the typical View export)
 * stay as data — losing the first row to over-eager header detection
 * caused real bugs.
 *
 * In practice this rule only fires for clean `Year,Region,Sales /
 * 2026,EU,1000`-style headers and never on raw view dumps.
 */
function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  for (let c = 0; c < rows[0].length; c++) {
    const head = (rows[0][c] ?? '').trim();
    if (head === '' || parseNumericCell(head) !== undefined) continue;
    for (let i = 1; i < rows.length; i++) {
      const v = (rows[i][c] ?? '').trim();
      if (v !== '' && parseNumericCell(v) !== undefined) return true;
    }
  }
  return false;
}

function inferColumnTypes(rows: string[][]): ('Numeric' | 'String')[] {
  if (rows.length === 0) return [];
  const cols = rows[0].length;
  const types: ('Numeric' | 'String')[] = new Array(cols).fill('Numeric');
  for (let c = 0; c < cols; c++) {
    let sawValue = false;
    for (const row of rows) {
      const cell = (row[c] ?? '').trim();
      if (cell === '') continue;
      sawValue = true;
      if (parseNumericCell(cell) === undefined) {
        types[c] = 'String';
        break;
      }
    }
    if (!sawValue) types[c] = 'String';
  }
  return types;
}

/** Parse a numeric cell honouring German-locale decimal-comma. Tries `.`
 *  first, falls back to comma-as-decimal-point if that fails. */
function parseNumericCell(t: string): number | undefined {
  if (t === '') return 0;
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  // Try `,` as decimal separator (e.g. "0,95" → 0.95). Reject if it has
  // multiple commas (likely thousands separator we can't disambiguate).
  if (t.indexOf(',') !== -1 && t.indexOf(',') === t.lastIndexOf(',')) {
    const swapped = Number(t.replace(',', '.'));
    if (Number.isFinite(swapped)) return swapped;
  }
  return undefined;
}

function coerceRow(row: string[], types: ('Numeric' | 'String')[]): Value[] {
  return row.map((c, i) => {
    if (types[i] === 'Numeric') {
      const n = parseNumericCell(c.trim());
      return n ?? 0;
    }
    return c;
  });
}

export function parseCsv(content: string): SourceTable {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.length > 0)
    .filter((l) => !l.trimStart().startsWith('#'));
  if (lines.length === 0) return { rows: [], columnTypes: [] };

  const delim = detectDelimiter(lines);
  const allRows = lines.map((l) => parseCsvLine(l, delim, false));

  let header: string[] | undefined;
  let dataRows = allRows;
  if (looksLikeHeader(allRows)) {
    header = allRows[0].map((c) => c.trim());
    dataRows = allRows.slice(1);
  }

  const columnTypes = inferColumnTypes(dataRows);
  const rows = dataRows.map((r) => coerceRow(r, columnTypes));
  return { header, rows, columnTypes };
}

export async function readCsv(filePath: string): Promise<SourceTable> {
  // A captured `_source.txt` is already UTF-8; a hand-placed export may be in the
  // server codepage (what SetInputCharacterSet names), so decode tolerantly.
  const content = decodeServerText(await fs.readFile(filePath));
  return parseCsv(content);
}

/**
 * Bind a row to scope variables. When `variableNames` is provided, each
 * row column is bound to the corresponding name (so a TI process whose
 * Variables list is e.g. ['vDim_1','vKPI_Cube_1','vwert'] gets the
 * right substitution). When omitted, falls back to the conventional
 * `vdim_<i>` / `v<i>` aliases (1-indexed).
 */
export function rowBindings(row: SourceRow, variableNames?: string[]): Record<string, Value> {
  const out: Record<string, Value> = {};
  if (variableNames && variableNames.length > 0) {
    for (let i = 0; i < row.length && i < variableNames.length; i++) {
      out[variableNames[i]] = row[i];
    }
    return out;
  }
  for (let i = 0; i < row.length; i++) {
    out[`vdim_${i + 1}`] = row[i];
    out[`v${i + 1}`] = row[i];
  }
  return out;
}
