// src/test/activation/stepBestEffort.test.ts
//
// Guard: a failed migration must NOT abort the activation.
//
// Until 2026-09-20, four migrations ran as bare `await`s before the first
// command registration. If one of them throws, not a single command is
// registered — visible as `command 'tm1.…' not found`, i.e. the same
// message as in the debug factory case of 09-19, just one level higher.
//
// No other gate sees this: `activate` runs in no test, and an
// `await` is syntactically flawless.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const logBestEffort = vi.hoisted(() => vi.fn());
vi.mock('../../providers/bestEffortLog', () => ({ logBestEffort }));

import { stepBestEffort } from '../../activation/stepBestEffort';

beforeEach(() => { logBestEffort.mockClear(); });

describe('stepBestEffort', () => {
  it('lets a successful step through', async () => {
    const run = vi.fn(async () => 'fertig');
    await stepBestEffort('x', run);
    expect(run).toHaveBeenCalled();
    expect(logBestEffort).not.toHaveBeenCalled();
  });

  it('swallows a throw and reports it to the log', async () => {
    await expect(stepBestEffort('migrateLegacyPasswords', async () => {
      throw new Error('SecretStorage unavailable');
    })).resolves.toBeUndefined();
    expect(logBestEffort).toHaveBeenCalledWith(
      'Activation', 'migrateLegacyPasswords', expect.any(Error));
  });

  it('also swallows a synchronous throw', async () => {
    // `initHealthStore(context)` can throw BEFORE there is a Promise.
    await expect(stepBestEffort('initHealthStore', () => {
      throw new Error('globalState corrupt');
    })).resolves.toBeUndefined();
    expect(logBestEffort).toHaveBeenCalled();
  });

  it('awaits the step — the order matters here', async () => {
    // `migrateLegacyPasswords` moves passwords into the SecretStorage, and
    // `restoreConnectedServers` reads them immediately afterwards. Decoupled,
    // that would be a race for credentials.
    const order: string[] = [];
    await stepBestEffort('langsam', async () => {
      await new Promise(r => setTimeout(r, 5));
      order.push('schritt');
    });
    order.push('danach');
    expect(order).toEqual(['schritt', 'danach']);
  });
});

describe('extension.ts: no bare migration any more', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../extension.ts'), 'utf8');

  /** The steps that run before the command registration (`initHealthStore` was dropped
   *  together with Server Health on 2026-09-23). */
  const STEPS = [
    'migrateLegacyPasswords',
    'runStateMigrations',
  ];

  it.each(STEPS)('%s runs through stepBestEffort', (step) => {
    expect(src).toContain(`stepBestEffort('${step}'`);
  });

  it.each(STEPS)('%s is NOT awaited bare', (step) => {
    // `await migrateLegacyPasswords(` or `await timer.run('migrateLegacyPasswords'` without
    // the helper in front — exactly the form that lets the activation break.
    const bare = new RegExp(`await\\s+(?:timer\\.run\\(')?${step}\\b`);
    expect(bare.test(src)).toBe(false);
  });
});
