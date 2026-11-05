// src/test/noCustomerNamesInSource.test.ts
//
// Guard: the SHIPPED state contains no object name of the test instance.
//
// Not a secret, but customer structure. On 2026-09-20 there were 36 hits in 15
// files under `src/`, all in measurement comments; they have been replaced by
// the MEASURED VALUE, which carries the evidence anyway.
//
// ── Why not just `src/` ────────────────────────────────────────────────────
//
// The first version of this guard checked exactly that: `src/` without
// `src/test/`. It was green while the server name of the test instance stood in
// `resources/native/win32-x64/README.md` — a file that is shipped IN the VSIX.
// It was found by a human during installation, not by the test. The lesson is
// written down here so it does not get lost: what has to be checked is what is
// SHIPPED, not what looks like it. That is why the scan now runs over all
// directories that the `files` allow list in package.json lets through.
//
// ── Why checksums and not a plain-text list ────────────────────────────────
//
// A list of the forbidden names IN a tracked file would be exactly what it is
// meant to prevent: after the cleanup this test would be the only place where
// the customer names still appear. That is why only SHA-256 prefixes live
// here. Whoever wants to add a new name appends its checksum — the plain text
// does not belong in the repo.
//
//   node -e "console.log(require('crypto').createHash('sha256')
//     .update('<name>'.toLowerCase()).digest('hex').slice(0,16))"
//
// ── What the test does NOT do ──────────────────────────────────────────────
//
// `scripts/` (112 hits) is deliberately excluded — it does not go into the
// VSIX, see MUSS 8 of the open-source publish checklist.
// `src/test/` has been included since 2026-10-02 (238 hits replaced, expected
// values renamed together with the names, `npm run check` green).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const ROOT = path.resolve(__dirname, '../..');

/**
 * SHA-256 prefixes (16 characters) of the lowercased object names.
 *
 * Not every customer name is fit to be an entry: one subset was named like the
 * TI function `SUBST`, and its checksum promptly flagged five harmless places
 * in the simulator and in the rules completion. A name that coincides with TM1
 * vocabulary does not belong on this list — the guard would then be nothing
 * but noise.
 */
const FORBIDDEN = new Set([
  '0482a769963b229a', '1e0dd05852c9360b', '2c1f6292b61e65d3', '3953b85e585e406d',
  '39a37ccd3e41e305', '5c5185949ce1406e', '5ddc2f10d01ea26a', '916bc975660bfbfe',
  '9182ff6dcb12cae9', 'b0b5edf9e8330664', 'd074f572be740600', 'e3c799eb90ef9eb5',
  'e5b46f7823b8431f', 'ea36b55da6f8232c', 'eafa2f2744f58ad4', '72bf3220ad7b5e1d',
  '96918a31c5cabebf', 'beb30e0cc4eaedc6', '63552118c23afd6c', '24872bb1c6cae47f',
  'dbbb917f86bd37f4', '959883947bd49768', '0f4519501ad4dc62',
  // 2026-11-05: element, attribute and object names found by a scan against the test instance.
  '00e3a919c6d8bacb', '7426956dbc32aa01', '5efd5c99606f3870', 'a55253545b915ed9',
  '41c6844a57b0c8d7', 'a442217524b212b0', 'de3ea0e6fa57cccb', '66a9be3a3e9a5ab3',
  '2440a13da8a787ba', '7558a0a4ea5e3090', 'e26bf2c2c384a87f', '0000c819d21e42dd',
  '762fa2d5f2b26290', 'fbfd58c930f6d1e9', '10ddf04f6dce0459', '5556daecf2d618cf',
  '93579090490e9795', 'c33460e1ddbfbadb', '8c80ec384ae64974', '66796385545eff29',
  'ad981f6199207d89', 'ce151d20f849c59f', '679cbfe39eeea126',
]);

const hash = (s: string): string =>
  createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 16);

/**
 * Identifier-like words, together with their `_`/`-` parts. Umlauts are
 * included: without them an element name containing `ä` fell apart into two
 * fragments, and neither of them matched its checksum (2026-09-25).
 */
const TOKEN = /[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_+-]{3,}/g;

/**
 * Roots from which the VSIX takes its files (`unzip -l` on the package,
 * 2026-09-20). `out/` is the output built from `src/` and is covered with it.
 */
const SHIPPED_ROOTS = ['src', 'resources', 'media', 'l10n', 'snippets', 'syntaxes'];

// Not shipped, but public once the repo is: the architecture docs named a test
// dimension (2026-10-13) that no shipped root contained.
const PUBLIC_ROOTS = ['docs/architecture'];

/** Text files — there is nothing to read in a `.png` or `.ttf`. */
const TEXT = /\.(ts|js|cjs|mjs|json|md|txt|svg|ps1|cs|tmLanguage)$/i;

function shippedSources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) { return out; }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      shippedSources(p, out);
    } else if (TEXT.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function allShipped(): string[] {
  // Root files ship too (README, CHANGELOG, package.json, package.nls.*.json);
  // the directory list alone never read them.
  const rootFiles = fs.readdirSync(ROOT)
    .filter(f => /^(README\.md|CHANGELOG\.md|SECURITY\.md|package(\.nls(\.[\w-]+)?)?\.json)$/.test(f))
    .map(f => path.join(ROOT, f));
  return [...rootFiles, ...[...SHIPPED_ROOTS, ...PUBLIC_ROOTS].flatMap(r => shippedSources(path.join(ROOT, r)))];
}

function findHits(): string[] {
  const hits: string[] = [];
  for (const file of allShipped()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(TOKEN)) {
        const word = m[0];
        // The whole word AND its parts: `Planung_Maintenance` should be
        // flagged even if only one part of it is on the list.
        const parts = [word, ...word.split(/[_+-]/)].filter(w => w.length >= 4);
        if (parts.some(w => FORBIDDEN.has(hash(w)))) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
          return;
        }
      }
    });
  }
  return hits;
}

describe('Shipped source without object names of the test instance', () => {
  it('knows any forbidden names at all', () => {
    // Otherwise the guard checks nothing and still stays green.
    expect(FORBIDDEN.size).toBeGreaterThan(8);
  });

  it('detects a name when it is present', () => {
    // Cross-check without plain text in the repo: the checksum of a known
    // entry must be in the set, a different one must not.
    const anyForbidden = [...FORBIDDEN][0];
    expect(FORBIDDEN.has(anyForbidden)).toBe(true);
    expect(FORBIDDEN.has(hash('cubeViewer'))).toBe(false);
  });

  it('reads the shipped directories at all', () => {
    // Otherwise the scan would run over an empty list and stay green.
    const files = allShipped();
    expect(files.length).toBeGreaterThan(500);
    // Exactly the file the first guard overlooked.
    expect(files.some(f => f.includes(path.join('resources', 'native')))).toBe(true);
  });

  // Hashes every token of every shipped file: ~1 s locally, but the CI run on
  // 2026-10-08 (whole suite 256 s) hit the 5 s default. Content check, not a
  // performance check — so the limit is generous.
  it('finds none in what is shipped', () => {
    expect(findHits()).toEqual([]);
  }, 60_000);
});
