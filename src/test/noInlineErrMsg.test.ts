import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Guard (mirrors the D1 noInlineEscape convention): forbid re-implementing the
// `<x> instanceof Error ? <x>.message : String(<x>)` idiom inline. Every extraction
// of a message from an unknown thrown value must route through the single helper in
// src/utils/errMsg.ts, so the pattern can't drift back in via copy-paste.
//
// Exempt: the helper file itself, the browser-bundle webviewClient (separate tsconfig,
// cannot import extension utils) and test files.

const SRC_ROOT = path.resolve(__dirname, '..');

const EXEMPT_FILES = new Set<string>([
  path.join(SRC_ROOT, 'utils', 'errMsg.ts'),
]);

function isExempt(file: string): boolean {
  if (EXEMPT_FILES.has(file)) { return true; }
  const rel = path.relative(SRC_ROOT, file);
  const top = rel.split(path.sep)[0];
  if (top === 'webviewClient' || top === 'test') { return true; }
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

// Inline errMsg: <ident> instanceof Error ? <ident>.message : String(...)
const ERRMSG_RE = /instanceof Error \? \w+\.message\s*:\s*String\(/;

// C7: forbid `catch (x: any)` — under strict:true a bare `catch (x)` is `unknown`,
// which forces narrowing (errMsg / instanceof) instead of unchecked `x.foo`. The
// `: any` opt-out silently defeats that, so it must not creep back in.
const CATCH_ANY_RE = /catch\s*\(\s*\w+\s*:\s*any\s*\)/;

function scan(re: RegExp, files: string[]): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    if (isExempt(f)) { continue; }
    const text = fs.readFileSync(f, 'utf8');
    // Collapse all whitespace to a single space before testing, so a re-inlined
    // copy that a formatter has wrapped across several lines (the errMsg ternary
    // wraps often) is still caught — a line-by-line scan would miss it.
    const normalized = text.replace(/\s+/g, ' ');
    if (re.test(normalized)) { offenders.push(path.relative(SRC_ROOT, f)); }
  }
  return offenders;
}

describe('guard: no inline errMsg extraction outside utils/errMsg', () => {
  const files: string[] = [];
  walk(SRC_ROOT, files);

  it('finds no inline `x instanceof Error ? x.message : String(x)` (use errMsg)', () => {
    const offenders = scan(ERRMSG_RE, files);
    expect(
      offenders,
      `Inline errMsg extraction found — import errMsg from utils/errMsg:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('finds no `catch (x: any)` (C7 — bare catch is unknown under strict; narrow via errMsg)', () => {
    const offenders = scan(CATCH_ANY_RE, files);
    expect(
      offenders,
      `catch (x: any) found — drop the ': any' so x is unknown, then use errMsg(x):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
