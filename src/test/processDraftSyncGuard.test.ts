import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source scan, same idea as `noManualBodyRelease` / `countFormatGuard`.
 *
 * Every edit path must go through `markContentChanged()`, which flips the dirty
 * flag AND refreshes the host's recovery mirror. A path that posts
 * `monacoContentChanged` on its own still marks the editor dirty — it just makes
 * that editor's unsaved work silently unrecoverable on close, which is exactly
 * the failure this machinery exists to prevent. Type-checking cannot catch it:
 * both are valid messages.
 */

const DIR = join(__dirname, '..', 'webviewClient', 'processEditorMonaco');
/** The single legitimate sender — `markContentChanged` itself lives here. */
const OWNER = 'draftSync.ts';

describe('process editor draft mirror', () => {
  it('has no direct monacoContentChanged post outside draftSync.ts', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
      if (file === OWNER || file === 'protocol.ts') { continue; }
      const src = readFileSync(join(DIR, file), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.includes("'monacoContentChanged'") && line.includes('postMessage')) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('still routes the edit paths through markContentChanged', () => {
    // Guards the inverse mistake: silently dropping the calls would make the
    // scan above pass with nothing left to protect.
    const init = readFileSync(join(DIR, 'init.ts'), 'utf8');
    const calls = init.split('\n').filter((l) => l.includes('markContentChanged()')).length;
    expect(calls).toBeGreaterThanOrEqual(5);
  });
});
