import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseExpectedCsv,
  expectedCellsToCsv,
  readExpectedOutput,
  expectedToAggregated,
  type ExpectedCell,
} from '../../../tiSimulator/output/csvOutputIo';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-out-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('parseExpectedCsv', () => {
  it('parses cube,e1,e2,...,value rows', () => {
    const r = parseExpectedCsv('Plan,Jan,Sales,1000\nPlan,Feb,Sales,2000\n');
    expect(r).toEqual([
      { cube: 'Plan', coord: ['Jan', 'Sales'], value: 1000 },
      { cube: 'Plan', coord: ['Feb', 'Sales'], value: 2000 },
    ]);
  });

  it('skips header row when present', () => {
    const r = parseExpectedCsv('cube,month,measure,value\nPlan,Jan,Sales,1000\n');
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ cube: 'Plan', coord: ['Jan', 'Sales'], value: 1000 });
  });

  it('treats non-numeric value column as string (CellPutS)', () => {
    // Use a 2-row CSV so header-detection (which would skip first row when
    // body has numeric) does not fire — both rows are pure strings.
    const r = parseExpectedCsv('Notes,Jan,Hello World\nNotes,Feb,Bye\n');
    expect(r[0]).toEqual({ cube: 'Notes', coord: ['Jan'], value: 'Hello World' });
    expect(r[1]).toEqual({ cube: 'Notes', coord: ['Feb'], value: 'Bye' });
  });

  it('handles single-coord rows', () => {
    const r = parseExpectedCsv('Cube,A,1\n');
    expect(r[0]).toEqual({ cube: 'Cube', coord: ['A'], value: 1 });
  });

  it('returns empty for empty input', () => {
    expect(parseExpectedCsv('')).toEqual([]);
  });
});

describe('expectedCellsToCsv', () => {
  it('round-trips simple cells', () => {
    const cells: ExpectedCell[] = [{ cube: 'Plan', coord: ['Jan'], value: 1000 }];
    const csv = expectedCellsToCsv(cells);
    expect(csv).toBe('Plan,Jan,1000\n');
  });

  it('escapes embedded commas + quotes', () => {
    const cells: ExpectedCell[] = [{ cube: 'P', coord: ['a,b'], value: `it"s` }];
    const csv = expectedCellsToCsv(cells);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"it""s"');
  });

  it('returns empty for empty input', () => {
    expect(expectedCellsToCsv([])).toBe('');
  });
});

describe('readExpectedOutput / writeExpectedOutput', () => {

  it('returns empty when no expected file present', async () => {
    expect(await readExpectedOutput(tmp)).toEqual([]);
  });

  it('reads JSONL fallback when CSV missing', async () => {
    const dir = path.join(tmp, 'expected');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'output.jsonl'),
      JSON.stringify({ cube: 'P', coord: ['A'], value: 1 }) + '\n',
      'utf8',
    );
    const r = await readExpectedOutput(tmp);
    expect(r).toEqual([{ cube: 'P', coord: ['A'], value: 1 }]);
  });
});

describe('expectedToAggregated', () => {
  it('builds aggregated map', () => {
    const m = expectedToAggregated([
      { cube: 'Plan', coord: ['Jan'], value: 100 },
      { cube: 'Plan', coord: ['Feb'], value: 200 },
    ]);
    expect(m.size).toBe(2);
  });
});
