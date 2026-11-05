import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const SRC = join(__dirname, '..');

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e === 'test' || e === 'test-integration' || e === 'node_modules') { continue; }
      yield* walk(full);
    } else if (e.endsWith('.ts')) {
      yield full;
    }
  }
}

/**
 * `createOutputChannel` at MODULE LEVEL is a side effect on import: the channel
 * is created as soon as anyone loads the module, and it is practically never
 * disposed again. On 2026-08-30 there were five such places — two of them with
 * the same name ("TM1 Git"), so the user had two entries with the same name in
 * the Output dropdown and the lines were spread across both.
 *
 * The way to do it is `outputChannel(name)` from `utils/outputChannel.ts`: lazy,
 * merged by name and released again via `disposeAllOutputChannels()` in
 * `deactivate()`. Exempt are the places that create the channel lazily
 * THEMSELVES inside a function — they do not have the problem.
 */
describe('OutputChannels', () => {
  it('are not created at module level', () => {
    const treffer: string[] = [];
    for (const datei of walk(SRC)) {
      const rel = relative(SRC, datei).split(sep).join('/');
      if (rel === 'utils/outputChannel.ts') { continue; }
      const zeilen = readFileSync(datei, 'utf8').split('\n');
      let tiefe = 0;
      for (const roh of zeilen) {
        const z = roh.trim();
        if (z.startsWith('//') || z.startsWith('*')) { continue; }
        // Module level means: no open brace above us.
        if (tiefe === 0 && z.includes('createOutputChannel')) {
          treffer.push(`${rel}: ${z}`);
        }
        for (const ch of roh) {
          if (ch === '{') { tiefe++; }
          else if (ch === '}') { tiefe = Math.max(0, tiefe - 1); }
        }
      }
    }
    expect(treffer).toEqual([]);
  });

  it('have no name twice', () => {
    const namen: string[] = [];
    for (const datei of walk(SRC)) {
      const src = readFileSync(datei, 'utf8');
      for (const m of src.matchAll(/outputChannel\(\s*'([^']+)'\s*\)/g)) { namen.push(m[1]); }
      for (const m of src.matchAll(/createOutputChannel\(\s*'([^']+)'/g)) { namen.push(m[1]); }
    }
    // Duplicate names are allowed AS LONG AS they go through `outputChannel()` —
    // the helper merges them into one channel. The only thing forbidden is a
    // name being created both via the helper and via the raw API.
    const roh = new Set<string>();
    for (const datei of walk(SRC)) {
      const rel = relative(SRC, datei).split(sep).join('/');
      if (rel === 'utils/outputChannel.ts') { continue; }
      for (const m of readFileSync(datei, 'utf8').matchAll(/createOutputChannel\(\s*'([^']+)'/g)) {
        roh.add(m[1]);
      }
    }
    const ueberHelfer = new Set<string>();
    for (const datei of walk(SRC)) {
      for (const m of readFileSync(datei, 'utf8').matchAll(/outputChannel\(\s*'([^']+)'\s*\)/g)) {
        ueberHelfer.add(m[1]);
      }
    }
    const gemischt = [...ueberHelfer].filter(n => roh.has(n));
    expect(gemischt).toEqual([]);
    expect(namen.length).toBeGreaterThan(5);
  });
});
