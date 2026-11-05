import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readJsonl,
  readJsonlAll,
} from '../../../tiTestFramework/storage/jsonlIo';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonl-test-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

type Row = { op: string; value: number };

/** Fixture writer: one JSON object per line, LF terminated. */
async function writeJsonl(file: string, items: unknown[]): Promise<void> {
  await fs.writeFile(file, items.map((i) => JSON.stringify(i) + '\n').join(''), 'utf8');
}

describe('readJsonl / readJsonlAll', () => {
  it('round-trips simple rows', async () => {
    const items: Row[] = [
      { op: 'CellPutN', value: 1 },
      { op: 'CellPutN', value: 2 },
      { op: 'CellIncrementN', value: 3 },
    ];
    const file = path.join(tmp, 'rows.jsonl');
    await writeJsonl(file, items);
    expect(await readJsonlAll<Row>(file)).toEqual(items);
  });

  it('handles empty iterable', async () => {
    const file = path.join(tmp, 'empty.jsonl');
    await writeJsonl(file, []);
    expect(await readJsonlAll(file)).toEqual([]);
  });

  it('streaming generator yields lazily', async () => {
    const file = path.join(tmp, 'stream.jsonl');
    await writeJsonl(file, Array.from({ length: 100 }, (_, i) => ({ i })));
    let count = 0;
    for await (const _ of readJsonl<{ i: number }>(file)) {
      count++;
      if (count === 5) break;
    }
    expect(count).toBe(5);
  });

  it('skips blank lines', async () => {
    const file = path.join(tmp, 'blanks.jsonl');
    await fs.writeFile(file, '{"a":1}\n\n\n{"a":2}\n');
    expect(await readJsonlAll(file)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('handles CRLF line endings', async () => {
    const file = path.join(tmp, 'crlf.jsonl');
    await fs.writeFile(file, '{"a":1}\r\n{"a":2}\r\n');
    expect(await readJsonlAll(file)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe('malformed handling', () => {
  it('throws on malformed by default', async () => {
    const file = path.join(tmp, 'bad.jsonl');
    await fs.writeFile(file, '{"a":1}\n{not json}\n');
    await expect(readJsonlAll(file)).rejects.toThrow(/malformed JSON/);
  });

  it('routes to onMalformed callback when provided', async () => {
    const file = path.join(tmp, 'bad.jsonl');
    await fs.writeFile(file, '{"a":1}\n{not json}\n{"a":2}\n');
    const errs: { line: string; lineNo: number }[] = [];
    const out = await readJsonlAll<{ a: number }>(file, {
      onMalformed: (line, lineNo) => errs.push({ line, lineNo }),
    });
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
    expect(errs).toHaveLength(1);
    expect(errs[0].lineNo).toBe(2);
  });
});
