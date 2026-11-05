import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const LIVE = join(__dirname, '../../scripts/live');

/**
 * Signs of a login or address written into the source:
 * - `Buffer.from('benutzer:passwort')` — the Basic auth form of the probes
 * - `password: '…'` / `PASS = '…'` with a literal
 * - an IPv4 address
 */
const KLARTEXT = [
  /Buffer\.from\(\s*['"][^'"]*:[^'"]*['"]/,
  /(?:PASS|PASSWORD|password|passwort)\s*[:=]\s*['"][^'"]+['"]/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
];

/**
 * As of 2026-08-30. **This number may only GO DOWN.**
 *
 * The 166 existing probes carry host, user and password as literals. They are
 * deliberately not rewritten: the same values are in 35 commits of history
 * anyway, so a rewrite changes nothing about the actual risk and would take
 * place in untested throwaway code. In addition, 55 places in production code
 * and architecture docs refer to these scripts by name — they are the evidence
 * for the project's "measured live" statements and are meant to stay.
 *
 * What matters: nothing new gets added. A new probe takes its connection data
 * from `scripts/live/_env.js` and leaves this number untouched. Whoever touches
 * an old probe anyway converts it as well and counts down here.
 */
const ALTFAELLE = 166;

// scripts/live/ is private (gitignored since 2026-10-13): the public repo has no
// probes, so the whole guard steps aside there instead of failing on the reads.
describe.skipIf(!existsSync(LIVE))('Live probes: credentials', () => {
  it('no NEW probe with credentials or address in the source', () => {
    const betroffen: string[] = [];
    for (const name of readdirSync(LIVE)) {
      if (!name.endsWith('.js')) { continue; }
      const src = readFileSync(join(LIVE, name), 'utf8');
      if (KLARTEXT.some(re => re.test(src))) { betroffen.push(name); }
    }
    expect(
      betroffen.length,
      betroffen.length > ALTFAELLE
        ? `Neue Sonde mit Zugangsdaten im Quelltext. Nimm tm1Env() aus scripts/live/_env.js.\n` +
          `Betroffen (${betroffen.length}, erlaubt ${ALTFAELLE}): ${betroffen.slice(-5).join(', ')}`
        : `Altfaelle sind gesunken — bitte ALTFAELLE in dieser Datei auf ${betroffen.length} setzen.`,
    ).toBe(ALTFAELLE);
  });

  it('_env.js itself carries no values', () => {
    const src = readFileSync(join(LIVE, '_env.js'), 'utf8');
    expect(KLARTEXT.some(re => re.test(src))).toBe(false);
  });

  it('.env.example names the keys, but no password', () => {
    const src = readFileSync(join(LIVE, '.env.example'), 'utf8');
    for (const k of ['TM1_HOST', 'TM1_PORT', 'TM1_USER', 'TM1_PASS']) {
      expect(src).toContain(k);
    }
    expect(/TM1_PASS=\S/.test(src)).toBe(false);
  });
});
