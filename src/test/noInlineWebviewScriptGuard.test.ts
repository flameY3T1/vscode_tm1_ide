// Guard: page logic of a webview lives in a typed bundle under src/webviewClient/,
// never as a script string in a host's template literal — there neither tsc nor
// eslint sees it (review 2026-10-26, P1 5; all hosts moved by 2026-10-28).
// `acquireVsCodeApi` is the marker: only a page script calls it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test' && name !== 'test-integration' && name !== 'webviewClient') { walk(p, out); }
    } else if (p.endsWith('.ts')) { out.push(p); }
  }
  return out;
}

describe('no inline webview page scripts', () => {
  it('no host file outside webviewClient/ calls acquireVsCodeApi', () => {
    const offenders = walk(SRC, [])
      .filter((f) => readFileSync(f, 'utf8').includes('acquireVsCodeApi'))
      .map((f) => relative(SRC, f));
    expect(offenders, 'Move the page script into src/webviewClient/<name>/index.ts and load it via scriptUris').toEqual([]);
  });
});
