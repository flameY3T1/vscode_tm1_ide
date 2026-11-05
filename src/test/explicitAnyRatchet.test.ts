import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * `@typescript-eslint/no-explicit-any` is off (eslint.config.mjs) because the
 * existing stock is too big for one round. This ratchet keeps it from growing:
 * the counts per layer may only SINK. Whoever removes some, lowers the number.
 * Counted by pattern (`: any`, `as any`, `<any>`, `any[]`), not by the linter —
 * close enough to see growth, fast enough for every test run.
 */
// Measured 2026-10-04; webviewClient lowered 2026-10-28 (dimensionEditor + processEditorMonaco).
const CEILING = { host: 74, webviewClient: 24 };

const SRC = join(__dirname, '..');
const ANY = /(?::\s*any\b|\bas any\b|<any>|\bany\[\])/g;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test' && name !== 'test-integration') { walk(p, out); }
    } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) { out.push(p); }
  }
  return out;
}

describe('explicit any ratchet', () => {
  it('no layer gains explicit `any`', () => {
    const counts = { host: 0, webviewClient: 0 };
    for (const f of walk(SRC, [])) {
      const n = readFileSync(f, 'utf8').match(ANY)?.length ?? 0;
      counts[relative(SRC, f).startsWith('webviewClient') ? 'webviewClient' : 'host'] += n;
    }
    expect(counts, `Explicit any: ${JSON.stringify(counts)}, allowed ${JSON.stringify(CEILING)}. Type it instead — or, if the count SANK, lower CEILING to match.`).toEqual(CEILING);
  });
});
