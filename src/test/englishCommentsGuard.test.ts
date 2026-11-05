// src/test/englishCommentsGuard.test.ts
//
// Guard: new comments under `src/` (tests excluded) are written in English.
//
// The existing German comments are translated folder by folder, so this is a
// ratchet, not a ban: `englishCommentsBaseline.json` records how many German
// comment lines each file still has. The test fails when a file gains German
// lines or a file outside the baseline gets any. It also fails when a file has
// FEWER lines than recorded, so every translation step tightens the baseline
// instead of leaving slack for a later regression. Rewrite the baseline with
//
//   UPDATE_COMMENT_BASELINE=1 npx vitest --run src/test/englishCommentsGuard.test.ts
//
// ── What counts as a comment line ──────────────────────────────────────────
//
// Line-based on purpose, not the TypeScript scanner: CSS and HTML comments
// inside template literals are string content to the scanner, and exactly
// those were skipped by the first translation pass (`comment-only-diff.mjs`
// cannot see them either). A line counts when it starts with `//`, `*`, `/*`
// or `<!--`, or carries a trailing ` // ` comment.
//
// ── What counts as German ──────────────────────────────────────────────────
//
// An umlaut/ß, or a German function word. Words that also occur in English
// comments (`die`, `des`, `mit`, `am`, `in`, `hier` as in `dim|hier`) are left
// out. Umlauts in an English comment (e.g. naming mojibake characters) are a
// known false positive; the baseline absorbs them.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_FILE = path.join(__dirname, 'englishCommentsBaseline.json');

// Line comments anywhere, block comments at line start AND inline (`x(); /* … */`).
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|<!--)|\s\/\/\s|\/\*.*\*\//;
const GERMAN_WORDS = ['und', 'nicht', 'wird', 'werden', 'wenn', 'weil', 'fuer', 'ueber', 'beim', 'sonst',
  'auch', 'noch', 'oder', 'dass', 'damit', 'kein', 'keine', 'eine', 'einen', 'sind', 'ist', 'bei', 'nur',
  'aus', 'zum', 'zur', 'vom', 'auf', 'der', 'das', 'den', 'dem', 'sich', 'schon', 'immer'];
// Lowercase or capitalised, never all-caps: `DER` is the certificate encoding.
const GERMAN = new RegExp(`[äöüÄÖÜß]|\\b(${GERMAN_WORDS.map(w => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`).join('|')})\\b`);

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== path.join(ROOT, 'src', 'test')) sources(p, out);
    } else if (/\.(ts|js|mjs|cjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function germanCommentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sources(path.join(ROOT, 'src')).sort()) {
    const n = fs.readFileSync(file, 'utf8').split('\n')
      .filter(l => COMMENT_LINE.test(l) && GERMAN.test(l)).length;
    if (n > 0) counts[path.relative(ROOT, file).split(path.sep).join('/')] = n;
  }
  return counts;
}

describe('comments under src/ are English', () => {
  it('no file has more German comment lines than the baseline, and the baseline is tight', () => {
    const actual = germanCommentCounts();
    if (process.env.UPDATE_COMMENT_BASELINE) {
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(actual, null, 2) + '\n');
    }
    const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

    const grown = Object.entries(actual)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(([f, n]) => `${f}: ${baseline[f] ?? 0} -> ${n}`);
    expect(grown, 'German comment lines added — write new comments in English').toEqual([]);

    const shrunk = Object.entries(baseline)
      .filter(([f, n]) => (actual[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} -> ${actual[f] ?? 0}`);
    expect(shrunk, 'German comments translated — rerun with UPDATE_COMMENT_BASELINE=1').toEqual([]);
  });
});
