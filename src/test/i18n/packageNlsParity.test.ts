import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Guard for the THIRD translation surface.
 *
 * `l10n/bundle.l10n.*.json` carries the runtime texts, `media/tiSignatureDocs.*`
 * the function help — and `package.nls.*.json` everything that VS Code ITSELF
 * shows before the extension is even running: command titles in the
 * command palette, view names, descriptions of the settings.
 *
 * Until 2026-08-31 this surface had no guard at all, even though it breaks
 * especially silently: VS Code shows an unknown key as the bare text
 * `%tm1.foo.title%` in the command palette — no error, no log, just an
 * ugly line. And a key that `package.json` no longer uses at all costs
 * every additional language a translation into the void.
 */

function loadNls(name: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), name), 'utf8')) as Record<string, string>;
}

/** All translated `package.nls.<language>.json` files — the source drops out. */
function translatedNls(): string[] {
  return readdirSync(resolve(process.cwd()))
    .filter((f) => /^package\.nls\.[a-z]{2}(?:-[a-z]{2,4})?\.json$/i.test(f))
    .sort();
}

const en = loadNls('package.nls.json');
const pkgRaw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
/** Every `"%key%"` reference from `package.json`. */
const used = new Set([...pkgRaw.matchAll(/"%([^"%]+)%"/g)].map((m) => m[1]));

const BRACE_GROUP = /\{[^}]*\}/g;
function braceGroups(s: string): string[] {
  return (s.match(BRACE_GROUP) ?? []).sort();
}

describe('package.nls parity', () => {
  it('every %key% from package.json is present in package.nls.json', () => {
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
  });

  it('package.nls.json carries no key that package.json does not use', () => {
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it('findet ueberhaupt uebersetzte Dateien', () => {
    // Without this, a broken file search could not be told apart from "all
    // green" — the loop below would then run over zero files.
    expect(translatedNls()).toContain('package.nls.de.json');
  });

  for (const file of translatedNls()) {
    describe(file, () => {
      const loc = loadNls(file);

      it('has the same keys as the English source', () => {
        expect({
          nurHier: Object.keys(loc).filter((k) => !(k in en)).sort(),
          nurEN: Object.keys(en).filter((k) => !(k in loc)).sort(),
        }).toEqual({ nurHier: [], nurEN: [] });
      });

      it('keeps every curly-brace group from the EN text', () => {
        const abweichend = Object.keys(en)
          .filter((k) => k in loc)
          .filter((k) => braceGroups(en[k]).join(' ') !== braceGroups(loc[k]).join(' '));
        expect(abweichend).toEqual([]);
      });

      it('has no empty value', () => {
        expect(Object.keys(loc).filter((k) => loc[k].trim() === '')).toEqual([]);
      });
    });
  }
});
