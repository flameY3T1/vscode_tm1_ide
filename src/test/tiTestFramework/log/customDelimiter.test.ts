import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseLog, quotedLineDelim } from '../../../tiTestFramework/log/logParser';
import { parseCsv } from '../../../tiSimulator/source/csvSource';
import { readExpectedDimDeltas } from '../../../commands/tiTest/expected';

/**
 * A process that sets `DatasourceASCIIDelimiter=CHAR(35)` makes TM1 write its
 * captured log AND its source dump `#`-separated (production test, 2026-11-03).
 * Only `,` and `;` were recognised: 2 of 1.8M log rows survived, and the
 * simulator read every source row as one field.
 */
describe('custom DatasourceASCIIDelimiter', () => {
  it('reads the delimiter after a leading quoted field', () => {
    expect(quotedLineDelim('"CellPutN"#"12"#"Plan"#"A"')).toBe('#');
    expect(quotedLineDelim('"CellPutS";"x"')).toBe(';');
    expect(quotedLineDelim('""#""')).toBe('#');
    expect(quotedLineDelim('"a""b"|"c"')).toBe('|');
    expect(quotedLineDelim('CellPutN,1,Plan')).toBeNull();
    expect(quotedLineDelim('"only"')).toBeNull();
  });

  it('parseLog keeps every #-separated write row, per line even when ; rows follow', () => {
    const log = [
      '"__CELLREAD__"#"N"#"Plan"#"A"#"B"#"1"',
      '"CellPutN"#"Plan"#"A"#"B"#"12.5"',
      '"CellPutS"#"Plan"#"A"#"C"#"txt"',
      '"CellPutS";"Doc";"X";"note"',
    ].join('\n');
    const { rows } = parseLog(log);
    expect(rows.map(r => r.op)).toEqual(['CellPutN', 'CellPutS', 'CellPutS']);
    expect(rows[0]).toMatchObject({ value: 12.5, cube: 'Plan', coord: ['A', 'B'] });
    expect(rows[2]).toMatchObject({ value: 'note', cube: 'Doc', coord: ['X'] });
  });

  it('the simulator source reader splits #-separated rows into columns', () => {
    const t = parseCsv('"A"#"B"#"3"\n"C"#"D"#"4"');
    expect(t.rows).toEqual([['A', 'B', 3], ['C', 'D', 4]]);
  });
});

describe('readExpectedDimDeltas with a very large log', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bigexp-')); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });

  it('keeps all rows past the spread-argument limit instead of dropping the file', async () => {
    const n = 200_000;
    const lines = Array.from({ length: n }, (_, i) => `"AttrPutS"#"D"#""#"E${i}"#"A"#"v${i}"`);
    await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'data', 'P_log.txt'), lines.join('\n'), 'utf8');
    const rows = await readExpectedDimDeltas(tmp);
    expect(rows).toHaveLength(n);
  });
});
