import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, relative, join } from 'path';

// Read + parse the two l10n bundles from the repo root (vitest runs with the
// project root as cwd). Avoids resolveJsonModule so no tsconfig change is needed.
function loadBundle(name: string): Record<string, string> {
  const p = resolve(process.cwd(), 'l10n', name);
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
}

/**
 * All language bundles in the `l10n/` folder — the English source
 * (`bundle.l10n.json`) drops out of the pattern, because `l10n.` must be followed
 * by a language code.
 */
function localeBundles(): string[] {
  return readdirSync(resolve(process.cwd(), 'l10n'))
    .filter((f) => /^bundle\.l10n\.[a-z]{2}(?:-[a-z]{2,4})?\.json$/i.test(f))
    .sort();
}

/**
 * Curly-brace groups of a text as a MULTISET (sorted).
 *
 * Deliberately NOT limited to `{0}`: the bundle also contains literal
 * forms from TI/MDX help texts (`{n}`, `{*}`, `{'E1','E2'}`), which a
 * translation may touch just as little as an argument placeholder.
 * Measured 2026-08-31: 12 different forms, and DE keeps all 2495
 * keys congruent — the guard starts green, so it reports no
 * legacy findings, only new errors.
 */
const BRACE_GROUP = /\{[^}]*\}/g;
function braceGroups(s: string): string[] {
  return (s.match(BRACE_GROUP) ?? []).sort();
}

describe('l10n bundle parity', () => {
  const en = loadBundle('bundle.l10n.json');
  const enKeys = Object.keys(en).sort();

  it('findet ueberhaupt Sprachbuendel', () => {
    // Without this, a broken file search could not be told apart from "all green"
    // — the loop below would then run over zero bundles.
    expect(localeBundles()).toContain('bundle.l10n.de.json');
  });

  for (const file of localeBundles()) {
    describe(file, () => {
      const loc = loadBundle(file);

      it('has the same keys as the EN bundle', () => {
        const locKeys = Object.keys(loc).sort();
        expect({
          nurHier: locKeys.filter((k) => !(k in en)),
          nurEN: enKeys.filter((k) => !(k in loc)),
        }).toEqual({ nurHier: [], nurEN: [] });
      });

      it('keeps every curly-brace group from the EN text', () => {
        const abweichend = enKeys
          .filter((k) => k in loc)
          .map((k) => ({ key: k, en: braceGroups(en[k]), loc: braceGroups(loc[k]) }))
          .filter((r) => r.en.join('\u0000') !== r.loc.join('\u0000'));
        expect(
          abweichend,
          'Platzhalter oder literale Klammerformen weichen ab. Ein verlorenes '
          + '{0} zeigt dem Nutzer die Klammer statt des Wertes, und KEIN anderes '
          + `Tor sieht das — Schluessel und Wert sind gleich falsch:\n`
          + abweichend
            .map((r) => `${JSON.stringify(r.key)}\n  EN        ${r.en.join(' ')}\n  ${file}  ${r.loc.join(' ')}`)
            .join('\n'),
        ).toEqual([]);
      });

      it('has no empty value', () => {
        // An empty string is a valid JSON value and a valid
        // bundle entry — the window then shows nothing.
        expect(enKeys.filter((k) => k in loc && loc[k].trim() === '')).toEqual([]);
      });
    });
  }

  it('the brace guard finds a lost group', () => {
    // Sharpness proof: a guard that never finds anything cannot be told apart
    // from a broken one.
    expect(braceGroups('Loaded {1} of {0} rows')).toEqual(['{0}', '{1}']);
    expect(braceGroups('{0} Zeilen geladen')).not.toEqual(['{0}', '{1}']);
    expect(braceGroups('Muster {*} und Menge {\'E1\',\'E2\'}'))
      .toEqual(["{'E1','E2'}", '{*}']);
  });
});

// ---------------------------------------------------------------------------
// Source ↔ bundle
//
// The parity test above only compares EN against DE. A text that is missing from BOTH
// bundles is symmetrically absent — and thus invisible to it,
// even though that is exactly the bug you expect an i18n guard to catch.
// This block closes the gap: it reads the `l10n.t()` calls from `src/**`
// and compares them against `bundle.l10n.json`.
// ---------------------------------------------------------------------------

const SRC = resolve(process.cwd(), 'src');

/** All `.ts`/`.tsx` under `src/`, without `src/test/` and without `*.test.ts`. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') { continue; }
      sourceFiles(p, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

// Covers `vscode.l10n.t(` just as well as the short form `l10n.t(` (both occur
// in the repo) and tolerates whitespace around the dot and the parenthesis.
const L10N_CALL = /\bl10n\s*\.\s*t\s*\(/g;

/**
 * Local short bindings to `l10n.t` — `const t = vscode.l10n.t;`.
 *
 * Without them, the scanner does NOT see the calls of two files (`commands/
 * threads.ts`, `commands/serverConfig/v12ManageDatabases.ts`, measured
 * 2026-08-25). That is not just an inaccurate orphan list: the red direction
 * above — missing key — was blind for these files as well.
 *
 * A false hit is harmless: if the pattern hits another `t(` with the same
 * name (in `threads.ts` a timer variable is also called that), there is
 * no string literal there, and the finding lands in `dynamic` instead of `missing`.
 */
const T_ALIAS_DECL = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:vscode\s*\.\s*)?l10n\s*\.\s*t\s*;/g;

/** Call pattern for ONE file: the full form plus its local aliases. */
function callPattern(src: string): RegExp {
  const namen = [...src.matchAll(T_ALIAS_DECL)].map((m) => m[1]);
  if (namen.length === 0) { return new RegExp(L10N_CALL.source, 'g'); }
  const alt = [...new Set(namen)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`${L10N_CALL.source}|\\b(?:${alt})\\s*\\(`, 'g');
}

/**
 * Reads ONE string literal from position `i` (leading whitespace is
 * skipped). Returns the RAW content between the quotation marks,
 * escapes still unresolved. `null` if there is no literal there — or a
 * template literal with `${…}`, whose value the scanner cannot know.
 */
function readLiteral(src: string, i: number): { raw: string; end: number } | null {
  let k = i;
  while (k < src.length && /\s/.test(src[k])) { k++; }
  const quote = src[k];
  if (quote !== "'" && quote !== '"' && quote !== '`') { return null; }
  let raw = '';
  let j = k + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { raw += c + src[j + 1]; j += 2; continue; }
    if (c === quote) { return { raw, end: j + 1 }; }
    if (quote === '`' && c === '$' && src[j + 1] === '{') { return null; }
    raw += c;
    j++;
  }
  return null;
}

/**
 * First argument of an `l10n.t()` call, including the concatenation of several
 * literals that is common in the repo (`'a\n' + 'b\n'`). `null` means: no
 * resolvable literal — variable, template with `${…}`, function call.
 */
function readFirstArg(src: string, i: number): string | null {
  let raw = '';
  let cur = i;
  for (;;) {
    const one = readLiteral(src, cur);
    if (!one) { return null; }
    raw += one.raw;
    cur = one.end;
    let k = cur;
    while (k < src.length && /\s/.test(src[k])) { k++; }
    if (src[k] === '+') { cur = k + 1; continue; }
    return raw;
  }
}

/**
 * Normalize escape forms: the bundle key is the VALUE of the literal,
 * not its source text. Without this, `…` (stored as `…` in the bundle),
 * `\'`, `\"`, `\\` and `\n` report false alarms by the dozen.
 */
function unescapeLiteral(raw: string): string {
  return raw
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\(['"`\\])/g, '$1');
}

interface ScanResult {
  /** Literal → erste Fundstelle `datei:zeile`. */
  literals: Map<string, string>;
  /** Locations with a variable instead of a literal — the scanner does NOT see them. */
  dynamic: string[];
}

function scanSource(src: string, label: string, into: ScanResult): void {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) { if (src[i] === '\n') { lineStarts.push(i + 1); } }
  // Comment lines mention `vscode.l10n.t(...)` for explanation — not a call.
  const commentLine = src.split('\n').map((l) => {
    const t = l.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  });
  for (const m of src.matchAll(callPattern(src))) {
    const at = m.index ?? 0;
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= at) { lo = mid; } else { hi = mid - 1; }
    }
    if (commentLine[lo]) { continue; }
    const where = `${label}:${lo + 1}`;
    const raw = readFirstArg(src, at + m[0].length);
    if (raw === null) { into.dynamic.push(where); continue; }
    const key = unescapeLiteral(raw);
    if (!into.literals.has(key)) { into.literals.set(key, where); }
  }
}

function scanRepo(): ScanResult {
  const result: ScanResult = { literals: new Map(), dynamic: [] };
  for (const file of sourceFiles(SRC)) {
    scanSource(readFileSync(file, 'utf8'), relative(SRC, file), result);
  }
  return result;
}

describe('l10n source ↔ bundle', () => {
  it('every l10n.t() literal from src/ is in the EN bundle', () => {
    const en = loadBundle('bundle.l10n.json');
    const { literals, dynamic } = scanRepo();
    const missing = [...literals.entries()]
      .filter(([key]) => !(key in en))
      .map(([key, where]) => `${where}  ${JSON.stringify(key)}`)
      .sort();
    expect(
      missing,
      `l10n.t()-Literale ohne Schlüssel in l10n/bundle.l10n.json `
      + `(${literals.size} Literale gescannt, ${dynamic.length} Aufrufe mit Variable `
      + `statt Literal übersprungen und damit UNGEPRÜFT:\n  ${dynamic.join('\n  ')}\n):\n`
      + missing.join('\n'),
    ).toEqual([]);
  });

  // Reverse direction: bundle keys no source uses any more. A key passed
  // through a variable (`l10n.t(label)`, column tables, lint messages) is not a
  // literal argument, so the scanner alone would call it orphaned. It counts as
  // used as soon as its text appears anywhere in the source — the error only
  // ever keeps a key too many, never deletes a live one. Cleaned up 2026-10-27
  // (19 keys, 85 reported by the literal scan alone, 66 of them indirect).
  it('no bundle key is orphaned', () => {
    const en = loadBundle('bundle.l10n.json');
    const { literals } = scanRepo();
    const text = sourceFiles(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
    const appears = (k: string) => text.includes(k) || text.includes(JSON.stringify(k).slice(1, -1));
    const orphans = Object.keys(en).filter((k) => !literals.has(k) && !appears(k));
    expect(orphans, 'keys no source uses; delete them from all bundles').toEqual([]);
  });

  it('the guard finds a missing key', () => {
    // Sharpness proof: the same scanner on a constructed snippet.
    // A regex that no longer finds anything is otherwise indistinguishable
    // from a broken one.
    const en = loadBundle('bundle.l10n.json');
    const probe = [
      "const a = vscode.l10n.t('Cancelled.');",                       // steht im Bündel
      "const b = vscode.l10n.t('zzz not in any bundle {0}', x);",     // fehlt
      "const c = l10n.t('Sort\\u2026');",                             // Escape-Normalisierung
      'const d = vscode.l10n.t(dynamicKey, ...args);',                // Variable → übersprungen
      "// erklaerender Kommentar zu vscode.l10n.t('nur Prosa')",      // Kommentar → ignoriert
    ].join('\n');
    const scan: ScanResult = { literals: new Map(), dynamic: [] };
    scanSource(probe, 'probe.ts', scan);

    expect([...scan.literals.keys()].sort())
      .toEqual(['Cancelled.', 'Sort…', 'zzz not in any bundle {0}']);
    expect(scan.dynamic).toEqual(['probe.ts:4']);

    // And the same sharpness for the local short binding, which exists twice in the
    // repo. That a non-l10n variable with the same name gets caught as well is
    // planned for: without a string literal, the finding lands in `dynamic`.
    const aliasProbe = [
      'const t = vscode.l10n.t;',
      "const a = t('Cancelled.');",
      "const b = t('zzz alias not in any bundle');",
      'const timer = timers.get(k); clearTimeout(timer);',
    ].join('\n');
    const aliasScan: ScanResult = { literals: new Map(), dynamic: [] };
    scanSource(aliasProbe, 'alias.ts', aliasScan);
    expect([...aliasScan.literals.keys()].sort())
      .toEqual(['Cancelled.', 'zzz alias not in any bundle']);

    const missing = [...scan.literals.keys()].filter((k) => !(k in en));
    expect(missing).toEqual(['zzz not in any bundle {0}']);
    // And the normalization holds: `…` finds the `…` key.
    expect('Sort…' in en).toBe(true);
  });
});
