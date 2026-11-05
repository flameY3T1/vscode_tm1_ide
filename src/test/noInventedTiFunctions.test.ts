import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';
import { builtinNames } from '../tiSimulator/eval/builtins';

/**
 * Names that do NOT exist in TM1 and must never come back.
 *
 * Autocomplete, snippets and the simulator all read from the signature data, so
 * an invented entry does more than clutter a list: it offers the user a call
 * that cannot compile on the server, and the simulator happily evaluates it, so
 * a TI test can pass against code TM1 would reject.
 *
 * Confirmed non-existent by flameY3T1 (TM1 side) on 2026-08-07; none of them has an
 * IBM doc page under `functions-`, `variables-`, `tlv-`, `rules-` or `reference-`.
 *
 * NOTE: absence of a doc page is NOT sufficient evidence on its own — a control
 * group of real functions showed the slug probe missing 2 of 15. Only add a name
 * here once someone has confirmed it against TM1 itself.
 */
const NOT_REAL = ['elisdesc', 'elisattr', 'attributeexists'];

describe('invented TI functions', () => {
  it('are absent from the signature map', () => {
    const present = NOT_REAL.filter((n) => KNOWN_SIGNATURES.has(n));
    expect(present).toEqual([]);
  });

  it('are absent from the simulator builtins', () => {
    const names = new Set(builtinNames().map((n) => n.toLowerCase()));
    expect(NOT_REAL.filter((n) => names.has(n))).toEqual([]);
  });

  it('are absent from the TI snippets', () => {
    const snippets = JSON.parse(readFileSync(join(__dirname, '..', '..', 'snippets', 'ti.json'), 'utf8'));
    const keys = Object.keys(snippets).map((k) => k.toLowerCase());
    expect(NOT_REAL.filter((n) => keys.includes(n))).toEqual([]);
  });

  it('are absent from the signature source files', () => {
    const dir = join(__dirname, '..', 'tiLogicVisualizer', 'signatures');
    const { readdirSync } = require('fs') as typeof import('fs');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const src = readFileSync(join(dir, file), 'utf8').toLowerCase();
      for (const n of NOT_REAL) {
        if (src.includes(`"${n}"`)) { offenders.push(`${file}: ${n}`); }
      }
    }
    expect(offenders).toEqual([]);
  });
});
