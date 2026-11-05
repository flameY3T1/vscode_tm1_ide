import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// D1 guard (fallback for the ESLint `no-restricted-syntax` rule — eslint.config.mjs
// is protected by a config-protection hook, so the guard lives here as a test):
// forbid re-implementing the OData/MDX escapes inline. Every `'`→`''` and `]`→`]]`
// must route through the single helper in src/utils/odataKey.ts. Recent v12 URL bugs
// came from a site that copied a PARTIAL pattern (quote-double, missing encode).
//
// Exempt: the helper file itself and test files. webviewClient is scanned too: its
// bundles import utils/odataKey (mdxParts.ts does), and the exemption let three
// local copies of the bracket escape grow there (review 2026-10-03, B4).

const SRC_ROOT = path.resolve(__dirname, '..');

const EXEMPT_FILES = new Set<string>([
  path.join(SRC_ROOT, 'utils', 'odataKey.ts'),
  // TI string literal escaper: same transformation (`'`→`''`), different grammar
  // (TI instead of OData). Deliberately a separate, tested helper — not an inline copy.
  path.join(SRC_ROOT, 'utils', 'tiLiteral.ts'),
]);

function isExempt(file: string): boolean {
  if (EXEMPT_FILES.has(file)) { return true; }
  const rel = path.relative(SRC_ROOT, file);
  const top = rel.split(path.sep)[0];
  if (top === 'test') { return true; }
  if (file.endsWith('.test.ts') || file.endsWith('.d.ts')) { return true; }
  return false;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); }
    else if (entry.isFile() && full.endsWith('.ts')) { out.push(full); }
  }
}

// OData quote-doubling: .replace(/'/g, "''")   (with or without surrounding spaces)
const ODATA_RE = /\.replace\(\s*\/'\/g\s*,\s*"''"\s*\)/;
// MDX bracket-doubling: .replace(/]/g, ']]'), .replace(/\]/g, ']]') or .split(']').join(']]')
const MDX_RE = /\.replace\(\s*\/\\?\]\/g\s*,\s*']]'\s*\)|\.split\(\s*'\]'\s*\)\.join\(\s*']]'\s*\)/;

// Same transformation, different grammar: `'` -> `''` inside an MDX '...' literal
// (FORMAT_STRING/CAPTION of a calculated member), not an OData key.
const ODATA_GRAMMAR_EXEMPT = new Set<string>([
  path.join(SRC_ROOT, 'cubeViewer', 'mdxFormatEmbedPure.ts'),
]);

function scan(re: RegExp, files: string[], exempt: ReadonlySet<string> = new Set()): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    if (isExempt(f) || exempt.has(f)) { continue; }
    const text = fs.readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) { offenders.push(`${path.relative(SRC_ROOT, f)}:${i + 1}`); }
    });
  }
  return offenders;
}

describe('D1 guard: no inline OData/MDX escapes outside utils/odataKey', () => {
  const files: string[] = [];
  walk(SRC_ROOT, files);

  it('finds no inline quote-doubling (use escapeODataKey/encodeODataKey)', () => {
    const offenders = scan(ODATA_RE, files, ODATA_GRAMMAR_EXEMPT);
    expect(
      offenders,
      `Inline OData escape found — import escapeODataKey/encodeODataKey from utils/odataKey:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('finds no inline bracket-doubling (use escapeMdx)', () => {
    const offenders = scan(MDX_RE, files);
    expect(
      offenders,
      `Inline MDX bracket escape found — import escapeMdx from utils/odataKey:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
