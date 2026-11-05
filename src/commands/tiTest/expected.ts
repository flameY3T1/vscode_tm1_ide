import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  readExpectedOutput,
  parseExpectedCsv,
  type ExpectedCell,
} from '../../tiSimulator/output/csvOutputIo';
import { parseLog } from '../../tiTestFramework/log/logParser';
import type { LogRow } from '../../tiTestFramework/log/logSchema';
import { resolveDataDir, resolveDataFile } from './loaders';

/**
 * Phase C2: read captured non-cell mutation rows.
 *
 * Two formats supported:
 *  - `dim-deltas.jsonl` (one JSON-object per line) — produced by
 *    captureWorkflow's auto-persist path.
 *  - `dim-deltas.txt` / `dim-deltas.csv` (TextOutput-CSV format
 *    `<op>,<arg1>,...,<argN>`) — produced when the user copies the helper
 *    process's log output from the TM1 server. Parsed via `parseLog` so the
 *    typed-row shape matches the JSONL form exactly.
 *
 * Empty / missing file → empty array (legacy cell-only tests).
 */
export async function readExpectedDimDeltas(testFolder: string): Promise<LogRow[]> {
  const jsonlCandidates = [
    path.join(testFolder, 'expected', 'dim-deltas.jsonl'),
    path.join(testFolder, 'data', 'dim-deltas.jsonl'),
  ];
  for (const p of jsonlCandidates) {
    try {
      const text = await fs.readFile(p, 'utf8');
      const rows: LogRow[] = [];
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          rows.push(JSON.parse(t) as LogRow);
        } catch {
          /* skip malformed line */
        }
      }
      return rows;
    } catch {
      /* try next */
    }
  }

  // Helper-produced log path: TM1 TextOutput CSV. We also scan the legacy
  // output.csv slot — if a user pasted the helper-log there by mistake, the
  // first column will be a known op name (AttrInsert, CubeDestroy, ...) and
  // parseLog will recover the typed rows. Cell-rows in the same file are
  // simply dropped by parseLog (unknown-op).
  const csvCandidates = [
    path.join(testFolder, 'data', 'dim-deltas.txt'),
    path.join(testFolder, 'data', 'dim-deltas.csv'),
    path.join(testFolder, 'expected', 'dim-deltas.txt'),
    path.join(testFolder, 'data', 'output.csv'),
    path.join(testFolder, 'expected', 'output.csv'),
  ];
  // Helper drops `<process>_log.txt` into data/ — accept any *_log.txt as
  // typed-op log without forcing the user to rename it.
  for (const dirRel of ['data', 'expected'] as const) {
    try {
      const dir = path.join(testFolder, dirRel);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && /_log\.txt$/i.test(e.name)) {
          csvCandidates.push(path.join(dir, e.name));
        }
      }
    } catch {
      /* dir missing — skip */
    }
  }
  // Union all matched *_log.txt files so sub-process logs are all included
  // in the expected baseline.
  const allRows: LogRow[] = [];
  for (const p of csvCandidates) {
    try {
      const text = await fs.readFile(p, 'utf8');
      const parsed = parseLog(text);
      // No spread: push(...rows) throws RangeError past ~120k rows (a 1.8M-row
      // production log), and the catch below then dropped the whole file silently.
      for (const r of parsed.rows) allRows.push(r);
    } catch {
      /* skip missing/malformed */
    }
  }
  if (allRows.length > 0) return allRows;
  return [];
}

export async function readExpectedFromAny(testFolder: string): Promise<ExpectedCell[]> {
  const csvPath = await resolveDataFile(testFolder, 'output.csv', 'expected');
  if (csvPath) {
    const txt = await fs.readFile(csvPath, 'utf8');
    const parsed = parseExpectedCsv(txt);
    if (parsed.length > 0) return parsed;
  }
  // Fall through: try the standard reader (handles .jsonl) then .dat fallback.
  const fromStd = await readExpectedOutput(testFolder);
  if (fromStd.length > 0) return fromStd;
  const dir = await resolveDataDir(testFolder, 'expected');
  let entries: { name: string; isFile: () => boolean }[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const resultFile = entries.find(
    (e) => e.isFile() && /_result\.(txt|dat)$/i.test(e.name),
  );
  // Fallback to any .txt/.dat as expected CELLS — but NEVER the datasource dump
  // (`<base>_source.txt`, whose rows are view coord+value tuples that would be
  // mis-read as expected cell-writes) or the op-log (`<base>_log.txt`, typed
  // ops incl. __TEXTOUTPUT__). Those feed the source loader and the dim-delta /
  // op path respectively — a pure export process has NO expected cells at all.
  const fallback =
    resultFile ??
    entries.find(
      (e) =>
        e.isFile() &&
        /\.(txt|dat)$/i.test(e.name) &&
        !/(_source|_log)\.(txt|dat)$/i.test(e.name),
    );
  if (!fallback) return [];
  const txt = await fs.readFile(path.join(dir, fallback.name), 'utf8');
  return parseExpectedCsv(txt);
}
