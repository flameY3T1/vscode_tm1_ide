/**
 * Node-environment auto-bootstrap for KNOWN_SIGNATURES.
 *
 * MUST be imported as the FIRST line of `src/extension.ts` so the Map is
 * populated BEFORE any transitive import that has module-load consumers
 * (e.g. tiParser/statements.ts:BARE_KEYWORDS IIFE, providers/* top-level Sets,
 * tiSystemVars.ts spread, tiServerLinter.ts for-loop).
 *
 * In CJS depth-first evaluation, this module runs first → its side-effect
 * populates KNOWN_SIGNATURES → all subsequent module-load reads see real data.
 *
 * Webviews bypass this path (DOM-side _shared/sigsBootstrap.ts handles them).
 *
 * Phase 3b regression hotfix.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initKnownSignatures, setIbmDocLanguage } from './tiSignatures';
import { parseSignaturesJson } from './tiSignaturesLoader';
import { initSignatureDocs } from './signatureDocs';
import { localeAssetNames } from '../utils/localeChain';

/**
 * Display language of the window, without importing `vscode` (see the reasoning below).
 * VS Code sets `VSCODE_NLS_CONFIG` in the extension host process; `locale` is the
 * chosen display language. Anything unexpected ends at `'en'`.
 */
export function uiLanguage(): string {
  try {
    const raw = process.env.VSCODE_NLS_CONFIG;
    if (!raw) { return 'en'; }
    const cfg = JSON.parse(raw) as { locale?: string; userLocale?: string };
    return (cfg.locale || cfg.userLocale || 'en').toLowerCase();
  } catch {
    return 'en';
  }
}

function readFirstExisting(rels: string[]): string | undefined {
  for (const p of rels) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* try next */ }
  }
  return undefined;
}

/**
 * Candidate paths for the translated function help, most specific first.
 *
 * The language chain lives in `utils/localeChain`, so that the second loader
 * (`utils/sigsAsset` for the webview) uses the same rule. Each step is searched
 * in BOTH locations, because bundled `__dirname` points at `<ext>/out` and
 * under test next to it.
 */
export function signatureDocsCandidates(locale: string): string[] {
  return localeAssetNames('tiSignatureDocs', 'json', locale).flatMap((f) => [
    path.resolve(__dirname, '..', 'media', f),
    path.resolve(__dirname, 'media', f),
  ]);
}

function bootstrapNode(): void {
  // Bundled extension.js lives at <ext-root>/out/extension.js → __dirname = .../out.
  // JSON assets are at <ext-root>/media/tiSignature{,Docs}.json.

  // P3-20: load docs FIRST. initKnownSignatures internally calls
  // applySignatureDocs, which reads the in-memory docs map populated here.
  // Language variant first, base after — English is the source, `.de.json` the
  // translation. The display language comes from `VSCODE_NLS_CONFIG` and NOT from
  // `vscode.env.language`: this module runs as a side effect in the first line
  // of `extension.ts`, before anything else is loaded, and is deliberately
  // vscode-free. If the variable or the file is missing, it stays English.
  const docsText = readFirstExisting(signatureDocsCandidates(uiLanguage()));
  if (docsText) {
    try {
      const parsed = JSON.parse(docsText) as { version?: number; docs?: Record<string, { description: string; paramDocs?: Record<string, string> }> };
      if (parsed.version === 1 && parsed.docs) { initSignatureDocs(parsed.docs); }
    } catch { /* leave docs empty — descriptions fall back to undefined */ }
  }

  // Must come BEFORE initKnownSignatures: that is where the doc URLs are baked
  // into the signatures. IBM serves the docs per language; an unsupported
  // code gives 404, so setIbmDocLanguage filters to the
  // measured list and otherwise falls back to English.
  setIbmDocLanguage(uiLanguage());

  const sigText = readFirstExisting([
    path.resolve(__dirname, '..', 'media', 'tiSignatures.json'),
    path.resolve(__dirname, 'media', 'tiSignatures.json'),
  ]);
  if (sigText) {
    initKnownSignatures(parseSignaturesJson(sigText));
    return;
  }
  console.error('[tm1] tiSignaturesNodeBoot: media/tiSignatures.json not found in any candidate path');
}

bootstrapNode();
