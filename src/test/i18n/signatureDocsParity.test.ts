import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { uiLanguage } from '../../tiLogicVisualizer/tiSignaturesNodeBoot';

/**
 * The TI function documentation has been bilingual since 2026-08-07: `tiSignatureDocs.json`
 * is the English SOURCE, `tiSignatureDocs.de.json` the translation. Which one is loaded
 * depends on the display language (`tiSignaturesNodeBoot` in the host, `utils/sigsAsset` in the webview).
 *
 * Without a guard the two drift apart: a new function lands in the
 * source and is missing from the translation — and because the loader picks ONE file and
 * does not mix, the German user gets no description at all for it instead of
 * the English one. Same intent as `bundleParity.test.ts` next door.
 */

interface Doc { description: string; paramDocs?: Record<string, string> }
interface DocsFile { version: number; docs: Record<string, Doc> }

function loadDocs(name: string): DocsFile {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'media', name), 'utf8')) as DocsFile;
}

/**
 * All translated documentation stores — the English source
 * (`tiSignatureDocs.json`) drops out, because the stem must be followed by a
 * language code.
 */
function translatedDocs(): string[] {
  return readdirSync(resolve(process.cwd(), 'media'))
    .filter((f) => /^tiSignatureDocs\.[a-z]{2}(?:-[a-z]{2,4})?\.json$/i.test(f))
    .sort();
}

const en = loadDocs('tiSignatureDocs.json');

it('findet ueberhaupt uebersetzte Doku-Ablagen', () => {
  // Without this, a broken file search could not be told apart from "all
  // green" — the loop below would then run over zero files.
  expect(translatedDocs()).toContain('tiSignatureDocs.de.json');
});

for (const file of translatedDocs()) {
  describe(`signature docs parity — ${file}`, () => {
    const loc = loadDocs(file);

    it('carries the same schema version as the source', () => {
      expect(en.version).toBe(1);
      expect(loc.version).toBe(en.version);
    });

    it('beschreibt dieselben Funktionen', () => {
      expect(Object.keys(loc.docs).sort()).toEqual(Object.keys(en.docs).sort());
    });

    it('beschreibt dieselben Parameter je Funktion', () => {
      for (const [fn, doc] of Object.entries(en.docs)) {
        expect(Object.keys(loc.docs[fn]?.paramDocs ?? {}).sort(), `params of ${fn}`)
          .toEqual(Object.keys(doc.paramDocs ?? {}).sort());
      }
    });

    it('has no empty description', () => {
      const leer = Object.entries(loc.docs)
        .filter(([, d]) => (d.description ?? '').trim() === '')
        .map(([fn]) => fn);
      expect(leer).toEqual([]);
    });
  });
}

describe('uiLanguage', () => {
  function withEnv(value: string | undefined, fn: () => void): void {
    const prev = process.env.VSCODE_NLS_CONFIG;
    if (value === undefined) { delete process.env.VSCODE_NLS_CONFIG; } else { process.env.VSCODE_NLS_CONFIG = value; }
    try { fn(); } finally {
      if (prev === undefined) { delete process.env.VSCODE_NLS_CONFIG; } else { process.env.VSCODE_NLS_CONFIG = prev; }
    }
  }

  it('reads the display language from VSCODE_NLS_CONFIG', () => {
    withEnv('{"locale":"de","userLocale":"de-de"}', () => expect(uiLanguage()).toBe('de'));
  });

  it('falls back to English when the variable is missing', () => {
    withEnv(undefined, () => expect(uiLanguage()).toBe('en'));
  });

  it('falls back to English on broken JSON instead of throwing', () => {
    withEnv('{not json', () => expect(uiLanguage()).toBe('en'));
  });
});
