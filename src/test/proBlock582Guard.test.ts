/**
 * Source scan: whoever WRITES block 582 of a `.pro` must take the list from
 * `splitVariableColumns`.
 *
 * Until 2026-08-30 there were two builders. One (export/deploy) knew the
 * ignored source columns, the other (`.pro` wizard) generated 582 from the
 * used variables and thereby deleted them — silently per process, visible only
 * after the next deploy on the server. Each builder was consistent on its own,
 * which is why something like this slips through every unit test.
 *
 * A third builder should not be added unnoticed.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
/** Emits a 582 header line: `582,` in a template or string literal. */
const EMITS = /(`582,|'582,|"582,)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === 'node_modules') { continue; }
      walk(p, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('block 582 has exactly one blueprint', () => {
  it('every writer gets its list from splitVariableColumns', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      // Comment lines do not count as writers.
      const code = src.split('\n')
        .filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n');
      if (!EMITS.test(code)) { continue; }
      if (!/processVariablesUi/.test(src)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
