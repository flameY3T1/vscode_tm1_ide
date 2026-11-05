import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// P4-5 guard (mirrors the D1 noInlineEscape / noInlineErrMsg convention): forbid
// re-implementing the "parse + release" memory pattern inline. Stufe 5 migrated
// every manual `JSON.parse(res.body) ... (res as {body?:string}).body = '';` pair
// (50 sites, Task 3 of the Stufe 5 typed-data plan) onto the
// single choke point in src/tm1Rest/parseRest.ts: `parseBody<T>(res)` (strict,
// throws on bad JSON) / `parseBodySafe<T>(res, fallback)` (tolerant). Both parse
// AND release (`res.body = ''`) in one place, so V8 can collect the (potentially
// 10+ MB) raw wire string right after parsing — see docs/architecture/memory-optimizations.md.
//
// FULL TEXT instead of lines (2026-08-24). All three checks used to run over
// `text.split('\n')` and saw each line on its own. A wrapped call —
// `JSON.parse(\n  res.body)`, or a `.body =\n  '';` — therefore slipped
// through, even though both expressions carry `\s*` at exactly the places
// where the line break sits: the line splitting, not the expression, was the
// gap. The search now runs over the whole file text; the line number for the
// message is computed back from the match index. Demonstrated in "proof of
// sharpness" below, including the counter-proof that the old line-by-line
// form does NOT find the same violation.
//
// Three checks:
//  1. THE load-bearing guard. No manual body-release mutation (`.body = ''`)
//     anywhere outside parseRest.ts. After the Stufe-5 migration there are ZERO
//     such sites left; any hit is either a straight regression or a new
//     large-payload call site that skipped parseBody/parseBodySafe. This check
//     alone delivers the full guarantee — do NOT remove it assuming check 2
//     covers the same ground.
//  2. A friendlier DIAGNOSTIC, deliberately SUBSUMED by check 1 (uses the same
//     RELEASE_RE over the same files, so it never fires on a line check 1 didn't
//     already flag — it adds no independent detection coverage). Its only value
//     is a better message: when the pre-Stufe-5 idiom (`JSON.parse(<x>.body)`
//     then a manual release of that same `<x>.body` a few lines down) is
//     re-pasted, it points at the parse line paired with its release, rather
//     than just the release line. Kept for that clearer offender message, not
//     for extra coverage — and the claim "subsumed" is now checked itself
//     (test "check 2 is truly subsumed…" below) instead of merely being
//     claimed. That is why it stays: it costs nothing and explains more.
//  3. Stufe 6b Task 1 guard (forward-looking): flags raw `parseEnvelope(<x>.body)` /
//     `parseODataValue(<x>.body)` calls (a raw-body ARGUMENT — the tolerant
//     STRING-based envelope family in parseRest.ts, distinct from checks 1/2
//     which cover the strict/tolerant parseBody/parseBodySafe family) anywhere
//     outside parseRest.ts. After the Task-1 migration (~30 sites: threadApi,
//     cubeApi, subsetApi, lintServer, tm1DebugClient, processApi, healthCollector,
//     sandboxApi, filesApi, choreApi, applicationsApi) these calls must go
//     through `parseEnvelopeBody`/`parseODataValueBody` instead (parse + release
//     in one step). `parseEnvelope(<stringVar>)` / `parseODataValue(<stringVar>)`
//     with a non-`.body` argument (e.g. a plain `body: string` parameter) is
//     explicitly ALLOWED — those never held onto a wire-sized response object,
//     there is nothing to release.
//
// Deliberately NOT flagged: standalone `JSON.parse(res.body)` with no release.
// The codebase has ~57 such sites (error-message extraction, `{ID}` cellset-create
// responses, `@odata.count`, `ProductVersion`, …) that were NEVER part of the
// body-release pattern — small bodies, no GC concern, out of scope for Stufe 5
// (confirmed against the Task 3 site list in stufe5-typed-data-plan.md; none of
// them ever had a `.body = ''` release to migrate). Banning ALL raw
// `JSON.parse(res.body)` regardless of release would false-positive on every one
// of those legitimate sites and force a padded allowlist — the opposite of what
// this guard is for. If a *new* large-payload site is added without going through
// parseBody/parseBodySafe, it will only trip this guard once it also grows a
// manual release next to it (check 2) or an outright `.body = ''` (check 1); a
// reviewer adding a large-payload site without release is a code-review concern,
// not something a source-scan regex can distinguish from a legitimate small parse.
//
// Exempt: parseRest.ts itself (the legitimate choke point — parseBody/parseBodySafe
// do exactly this parse+release internally), the browser-bundle webviewClient
// (separate tsconfig, cannot import extension utils / never touches ApiResponse)
// and test files.

const SRC_ROOT = path.resolve(__dirname, '..');

const EXEMPT_FILES = new Set<string>([
  path.join(SRC_ROOT, 'tm1Rest', 'parseRest.ts'),
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

// Manual body-release mutation: `.body = ''` or `.body = ""` (with or without
// surrounding spaces / a preceding cast like `(res as { body?: string })`).
// `\s` spans newlines, and the full-text scan now lets it do so.
const RELEASE_RE = /\.body\s*=\s*(''|"")/;

// Raw JSON.parse of an HTTP response body: `JSON.parse(res.body)`,
// `JSON.parse(execRes.body)`, etc. Captures the object identifier so the
// paired scan can confirm the SAME variable is released nearby.
const PARSE_BODY_RE = /JSON\.parse\(\s*(\w+)\.body\s*\)/;

// Raw envelope/value parse of a `.body`-shaped argument: `parseEnvelope(res.body)`,
// `parseODataValue<Foo>(elemRes.body)`, etc. The optional generic type argument
// (`<...>`) is matched GREEDILY up to the last `>` before the call's opening
// `(` — `.` matches no newline, so the type argument stays local to its line,
// which is intended (there is no generic broken across lines here). The
// argument part after it, on the other hand, may wrap (`\s*`).
// Requires a `.body` suffix on the argument (so `parseEnvelope(body)` — a plain
// `body: string` parameter, no dot — does NOT match; only `<ident>.body` does).
const RAW_ENVELOPE_BODY_RE = /\b(?:parseEnvelope|parseODataValue)\s*(?:<.*>)?\s*\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.body\b/;

/** Line number (1-based) for a character index in the full text. */
function zeileVon(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') { n++; }
  }
  return n;
}

/** All matches of an expression in the FULL TEXT, with line number. */
function trefferImVolltext(text: string, re: RegExp): Array<{ line: number; match: RegExpExecArray }> {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: Array<{ line: number; match: RegExpExecArray }> = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    out.push({ line: zeileVon(text, m.index), match: m });
    // Empty matches cannot occur, but a progress guard costs nothing.
    if (m.index === global.lastIndex) { global.lastIndex++; }
  }
  return out;
}

// ── Check 1: the manual release ────────────────────────────────────────────

export function scanManualReleaseText(rel: string, text: string): string[] {
  return trefferImVolltext(text, RELEASE_RE).map(t => `${rel}:${t.line}`);
}

function scanManualRelease(files: string[]): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    if (isExempt(f)) { continue; }
    offenders.push(...scanManualReleaseText(path.relative(SRC_ROOT, f), fs.readFileSync(f, 'utf8')));
  }
  return offenders;
}

// ── Check 2: parse and release as a pair ───────────────────────────────────

// Look-ahead window for the paired scan: the pre-Stufe-5 idiom always released
// on the very next line, but allow a few lines of slack (blank lines / a type
// annotation in between) before declaring the pair unrelated.
const PAIR_WINDOW = 5;

export function scanParseReleasePairText(rel: string, text: string): string[] {
  const lines = text.split('\n');
  const offenders: string[] = [];
  for (const { line, match } of trefferImVolltext(text, PARSE_BODY_RE)) {
    const varName = match[1];
    // The real pre-Stufe-5 idiom casts the object before releasing —
    // `(res as { body?: string }).body = '';` — so `varName` and `.body = ''`
    // are NOT textually adjacent. Match them independently on the same line:
    // RELEASE_RE (the mutation) AND a word-boundary mention of the same var.
    const varMentionRe = new RegExp(`\\b${varName}\\b`);
    // `line` is the line where the parse BEGINS; a wrapped call ends one line
    // later, and the start of the window covers that too.
    for (let j = line; j < Math.min(line + PAIR_WINDOW, lines.length); j++) {
      if (RELEASE_RE.test(lines[j]) && varMentionRe.test(lines[j])) {
        offenders.push(
          `${rel}:${line} (parse) + :${j + 1} (manual release) — use parseBody/parseBodySafe instead`,
        );
        break;
      }
    }
  }
  return offenders;
}

function scanParseReleasePair(files: string[]): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    if (isExempt(f)) { continue; }
    offenders.push(...scanParseReleasePairText(path.relative(SRC_ROOT, f), fs.readFileSync(f, 'utf8')));
  }
  return offenders;
}

// ── Check 3: raw envelope parse on a `.body` ───────────────────────────────

export function scanRawEnvelopeBodyText(rel: string, text: string): string[] {
  return trefferImVolltext(text, RAW_ENVELOPE_BODY_RE).map(t => `${rel}:${t.line}`);
}

function scanRawEnvelopeBodyCalls(files: string[]): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    if (isExempt(f)) { continue; }
    offenders.push(...scanRawEnvelopeBodyText(path.relative(SRC_ROOT, f), fs.readFileSync(f, 'utf8')));
  }
  return offenders;
}

describe('P4-5 guard: no manual parse+release outside tm1Rest/parseRest.ts', () => {
  const files: string[] = [];
  walk(SRC_ROOT, files);

  it('finds no manual body-release mutation (use parseBody/parseBodySafe)', () => {
    const offenders = scanManualRelease(files);
    expect(
      offenders,
      `Manual ".body = ''" release found outside parseRest.ts — route through parseBody<T>/parseBodySafe<T>:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('finds no reintroduced JSON.parse(res.body) + manual release pair (use parseBody/parseBodySafe)', () => {
    const offenders = scanParseReleasePair(files);
    expect(
      offenders,
      `Manual parse+release pair found outside parseRest.ts — route through parseBody<T>/parseBodySafe<T>:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('finds no raw parseEnvelope(<x>.body)/parseODataValue(<x>.body) outside parseRest.ts (use parseEnvelopeBody/parseODataValueBody)', () => {
    const offenders = scanRawEnvelopeBodyCalls(files);
    expect(
      offenders,
      `Raw parseEnvelope(<x>.body)/parseODataValue(<x>.body) found outside parseRest.ts — route through parseEnvelopeBody<T>/parseODataValueBody<T>:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// ── Proof of sharpness ─────────────────────────────────────────────────────
//
// Modelled on `countFormatGuard.test.ts`: run the guard against a constructed
// violation. Otherwise a scan that finds nothing in the real source cannot be
// told apart from a scan that CANNOT find anything — and that is exactly what
// it was for wrapped calls.

/** The old line-by-line form — kept only as a yardstick in the proof. */
function altZeilenweise(text: string, re: RegExp): number {
  return text.split('\n').filter(l => re.test(l)).length;
}

describe('P4-5 guard — proof of sharpness', () => {
  it('finds the single-line manual release', () => {
    const bad = [
      'const parsed = JSON.parse(res.body) as Foo;',
      "(res as { body?: string }).body = '';",
    ].join('\n');
    expect(scanManualReleaseText('x.ts', bad)).toEqual(['x.ts:2']);
    expect(scanParseReleasePairText('x.ts', bad)).toHaveLength(1);
  });

  it('finds the WRAPPED release — the old line check did not', () => {
    const bad = [
      'const parsed = JSON.parse(res.body) as Foo;',
      '(res as { body?: string }).body =',
      "  '';",
    ].join('\n');
    expect(scanManualReleaseText('x.ts', bad)).toEqual(['x.ts:2']);
    // The counter-proof: line by line, the same violation was invisible.
    expect(altZeilenweise(bad, RELEASE_RE)).toBe(0);
  });

  it('finds the WRAPPED JSON.parse — the old line check did not', () => {
    const bad = [
      'const parsed = JSON.parse(',
      '  res.body) as Foo;',
      "(res as { body?: string }).body = '';",
    ].join('\n');
    const paare = scanParseReleasePairText('x.ts', bad);
    expect(paare).toHaveLength(1);
    // The message points at the line where the parse BEGINS, and at the
    // matching release.
    expect(paare[0]).toContain('x.ts:1 (parse)');
    expect(paare[0]).toContain(':3 (manual release)');
    expect(altZeilenweise(bad, PARSE_BODY_RE)).toBe(0);
  });

  it('finds the WRAPPED parseEnvelope(<x>.body)', () => {
    const bad = 'const env = parseEnvelope<Foo>(\n  res.body,\n);';
    expect(scanRawEnvelopeBodyText('x.ts', bad)).toEqual(['x.ts:1']);
    expect(altZeilenweise(bad, RAW_ENVELOPE_BODY_RE)).toBe(0);
  });

  it('does NOT fire on the allowed forms', () => {
    const good = [
      'const parsed = parseBody<Foo>(res);',
      'const tolerant = parseBodySafe<Foo>(res, {});',
      'const env = parseEnvelopeBody<Foo>(res);',
      // A plain parse WITHOUT a release is explicitly allowed (~57 sites).
      'const id = JSON.parse(res.body).ID as string;',
      // An envelope over a plain string parameter has nothing to release.
      'const e = parseEnvelope<Foo>(body);',
    ].join('\n');
    expect(scanManualReleaseText('x.ts', good)).toEqual([]);
    expect(scanParseReleasePairText('x.ts', good)).toEqual([]);
    expect(scanRawEnvelopeBodyText('x.ts', good)).toEqual([]);
  });

  it('check 2 is truly subsumed — it never finds anything that check 1 misses', () => {
    // The claim from the header comment, now checked instead of claimed:
    // check 2 requires a RELEASE_RE match in the same file, which check 1 by
    // construction also sees. It stays anyway — because of the better
    // message, not because of additional coverage.
    const faelle = [
      "const p = JSON.parse(res.body);\n(res as { body?: string }).body = '';",
      "const p = JSON.parse(\n  execRes.body);\nexecRes.body = '';",
      "const p = JSON.parse(res.body);\n\n\n(res as { body?: string }).body = \"\";",
    ];
    for (const f of faelle) {
      expect(scanParseReleasePairText('x.ts', f).length).toBeGreaterThan(0);
      // …and in EVERY one of these cases check 1 fires too.
      expect(scanManualReleaseText('x.ts', f).length).toBeGreaterThan(0);
    }
    // The reverse does NOT hold — check 1 is the broader of the two.
    const nurEins = "(res as { body?: string }).body = '';";
    expect(scanManualReleaseText('x.ts', nurEins)).toHaveLength(1);
    expect(scanParseReleasePairText('x.ts', nurEins)).toHaveLength(0);
  });
});
