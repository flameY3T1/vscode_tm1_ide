import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readExpectedDimDeltas,
  readExpectedFromAny,
} from '../../../commands/tiTest/expected';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'expected-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

async function write(rel: string, body: string): Promise<void> {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
}

describe('readExpectedDimDeltas', () => {
  it('returns empty array when no files exist', async () => {
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows).toEqual([]);
  });

  it('parses JSONL from expected/dim-deltas.jsonl', async () => {
    const row = { op: 'AttrInsert', dim: 'D', hier: 'D', element: 'E', attribute: 'A', type: 'String' };
    await write('expected/dim-deltas.jsonl', JSON.stringify(row) + '\n');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ op: 'AttrInsert', dim: 'D', attribute: 'A' });
  });

  it('prefers expected/ over data/ for dim-deltas.jsonl', async () => {
    await write('expected/dim-deltas.jsonl', JSON.stringify({ op: 'AttrInsert', dim: 'FromExpected', hier: 'H', element: 'E', attribute: 'A', type: 'String' }) + '\n');
    await write('data/dim-deltas.jsonl', JSON.stringify({ op: 'AttrInsert', dim: 'FromData', hier: 'H', element: 'E', attribute: 'A', type: 'String' }) + '\n');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows[0]).toMatchObject({ dim: 'FromExpected' });
  });

  it('falls back to data/dim-deltas.jsonl when expected/ missing', async () => {
    await write('data/dim-deltas.jsonl', JSON.stringify({ op: 'AttrInsert', dim: 'D2', hier: 'H', element: 'E', attribute: 'A', type: 'String' }) + '\n');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows[0]).toMatchObject({ dim: 'D2' });
  });

  it('skips malformed JSONL lines', async () => {
    const good = JSON.stringify({ op: 'AttrInsert', dim: 'D', hier: 'H', element: 'E', attribute: 'A', type: 'String' });
    await write('expected/dim-deltas.jsonl', good + '\n{not json}\n' + good + '\n');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows).toHaveLength(2);
  });

  it('parses CSV fallback (TextOutput format) via parseLog', async () => {
    // AttrInsert needs 6 args: dim, hier, element, attribute, type, prevAttr.
    await write('data/dim-deltas.csv', 'AttrInsert,Region,Region,North,Color,String,\n');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].op).toBe('AttrInsert');
  });

  it('scans *_log.txt files in data/ when no jsonl present', async () => {
    await write('data/myproc_log.txt', 'AttrInsert,D,D,E,A,String,\n');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].op).toBe('AttrInsert');
  });
});

describe('readExpectedFromAny', () => {
  it('returns empty array when no expected files exist', async () => {
    const cells = await readExpectedFromAny(tmp);
    expect(cells).toEqual([]);
  });

  it('reads from expected/output.csv (legacy layout)', async () => {
    await write('expected/output.csv', 'Plan,Jan,Sales,1000\n');
    const cells = await readExpectedFromAny(tmp);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ cube: 'Plan', coord: ['Jan', 'Sales'], value: 1000 });
  });

  it('reads from data/output.csv (new layout) preferred', async () => {
    await write('data/output.csv', 'NewCube,A,42\n');
    await write('expected/output.csv', 'OldCube,A,99\n');
    const cells = await readExpectedFromAny(tmp);
    expect(cells[0]).toMatchObject({ cube: 'NewCube' });
  });

  it('falls back to *_result.txt when output.csv missing', async () => {
    await write('expected/myproc_result.txt', 'Plan,Jan,Sales,2500\n');
    const cells = await readExpectedFromAny(tmp);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ cube: 'Plan', value: 2500 });
  });

  it('falls back to any .txt/.dat when no _result file present', async () => {
    await write('expected/whatever.dat', 'Plan,X,7\n');
    const cells = await readExpectedFromAny(tmp);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ cube: 'Plan', value: 7 });
  });

  it('does NOT read the datasource dump (<base>_source.txt) as expected cells', async () => {
    // Regression: a pure export process (cube-view datasource, no CellPut) dumps
    // view rows to `<base>_source.txt`. Those `dim,…,dim,value` tuples were being
    // mis-read as expected cell-writes, producing phantom cell diffs (Expected
    // value / Actual ∅) since the simulator correctly writes no cells.
    await write('data/08206_source.txt', '2025,M01,IST,100001,P Aufwand,-66399,09\n');
    const cells = await readExpectedFromAny(tmp);
    expect(cells).toEqual([]);
  });

  it('does NOT read the op-log (<base>_log.txt) as expected cells', async () => {
    await write('data/08206_log.txt', '__TEXTOUTPUT__,exp.txt,2025,M01,-66399,09\n');
    const cells = await readExpectedFromAny(tmp);
    expect(cells).toEqual([]);
  });
});
