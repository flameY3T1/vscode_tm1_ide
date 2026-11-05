// Source guard: server-bound `globalState` keys appear ONLY in
// `serverState/stateKeys.ts`.
//
// The key is the only link between a store and the cleanup when the profile is
// deleted. If a module writes its own string literal, it drops out of
// `SERVER_STATE_KEYS` and nobody notices: the store keeps working, only its
// entries outlive the deleted profile, unreachable, in `globalState`. That is
// exactly how the state of 2026-08-29 came about — two of nine stores were
// cleaned up, the remaining seven never, and both exceptions had been added
// one by one after they had been noticed one by one (Review H4, Task 8).
//
// A unit test does not catch this: each store on its own is correct.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SERVER_STATE_KEYS } from '../serverState/stateKeys';

const SRC = path.resolve(__dirname, '..');
const TABELLE = path.join(SRC, 'serverState', 'stateKeys.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'test-integration' || entry.name === 'node_modules') { continue; }
      walk(p, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Strip comments, so that the explanatory text above does not trigger itself. */
function ohneKommentare(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('server-bound globalState keys', () => {
  it('appear as literals only in stateKeys.ts', () => {
    const treffer: string[] = [];
    for (const datei of walk(SRC)) {
      if (path.resolve(datei) === TABELLE) { continue; }
      const code = ohneKommentare(fs.readFileSync(datei, 'utf8'));
      for (const { key } of SERVER_STATE_KEYS) {
        if (code.includes(`'${key}'`) || code.includes(`"${key}"`) || code.includes(`\`${key}\``)) {
          treffer.push(`${path.relative(SRC, datei)}: ${key}`);
        }
      }
    }
    expect(treffer).toEqual([]);
  });

  it('are distinct from each other and not empty', () => {
    const keys = SERVER_STATE_KEYS.map(e => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(k => k.startsWith('tm1.'))).toBe(true);
  });
});
