import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readRunState,
  writeRunState,
  recordRun,
  runStatePath,
  RUN_STATE_FILENAME,
} from '../../../tiTestFramework/storage/runStateIo';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'runstate-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('runStateIo', () => {
  it('readRunState returns empty for missing file', async () => {
    const state = await readRunState(tmp);
    expect(state).toEqual({});
  });

  it('writeRunState + readRunState roundtrip', async () => {
    await writeRunState(tmp, {
      lastRun: { result: 'pass', at: 1746789600000 },
      lastSuccessAt: 1746789600000,
    });
    const state = await readRunState(tmp);
    expect(state).toEqual({
      lastRun: { result: 'pass', at: 1746789600000 },
      lastSuccessAt: 1746789600000,
    });
  });

  it('writes JSON file at .last-run.json with trailing newline', async () => {
    await writeRunState(tmp, { lastRun: { result: 'fail', at: 100 } });
    const raw = await fs.readFile(runStatePath(tmp), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ lastRun: { result: 'fail', at: 100 } });
  });

  it('RUN_STATE_FILENAME is hidden file', () => {
    expect(RUN_STATE_FILENAME).toBe('.last-run.json');
  });

  it('readRunState ignores malformed JSON', async () => {
    await fs.writeFile(runStatePath(tmp), '{ not json');
    expect(await readRunState(tmp)).toEqual({});
  });

  it('readRunState rejects bad result enum', async () => {
    await fs.writeFile(
      runStatePath(tmp),
      JSON.stringify({ lastRun: { result: 'maybe', at: 1 } }),
    );
    expect(await readRunState(tmp)).toEqual({});
  });

  it('readRunState rejects non-number at', async () => {
    await fs.writeFile(
      runStatePath(tmp),
      JSON.stringify({ lastRun: { result: 'pass', at: 'today' } }),
    );
    expect(await readRunState(tmp)).toEqual({});
  });
});

describe('recordRun', () => {
  it('first pass sets lastRun + lastSuccessAt', () => {
    const out = recordRun({}, true, 1000);
    expect(out).toEqual({
      lastRun: { result: 'pass', at: 1000 },
      lastSuccessAt: 1000,
    });
  });

  it('first fail sets lastRun, no lastSuccessAt', () => {
    const out = recordRun({}, false, 1000);
    expect(out).toEqual({ lastRun: { result: 'fail', at: 1000 } });
  });

  it('subsequent fail preserves prior lastSuccessAt', () => {
    const prev = recordRun({}, true, 1000);
    const out = recordRun(prev, false, 2000);
    expect(out).toEqual({
      lastRun: { result: 'fail', at: 2000 },
      lastSuccessAt: 1000,
    });
  });

  it('subsequent pass updates lastSuccessAt', () => {
    const prev = recordRun({}, true, 1000);
    const out = recordRun(prev, true, 2000);
    expect(out).toEqual({
      lastRun: { result: 'pass', at: 2000 },
      lastSuccessAt: 2000,
    });
  });

  it('uses Date.now() default when no atMs provided', () => {
    const before = Date.now();
    const out = recordRun({}, true);
    const after = Date.now();
    expect(out.lastRun!.at).toBeGreaterThanOrEqual(before);
    expect(out.lastRun!.at).toBeLessThanOrEqual(after);
  });
});
