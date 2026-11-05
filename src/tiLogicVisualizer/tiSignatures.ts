import type { TiSection } from './lintTypes';
import { applySignatureDocs } from './signatureDocs';
import { IBM_DOC_NONE, IBM_DOC_PAGES } from './ibmDocPages';

/** Type information for a single function parameter */
export interface TiParamInfo {
  name: string;
  type: 'string' | 'numeric' | 'any';
  /** Optional description of the parameter (for SignatureHelp) */
  doc?: string;
  /** When set, a string-literal argument at this position must (case-insensitively)
   *  be one of these values. Validated by the 'invalid-arg-value' lint rule. */
  allowedValues?: string[];
}

/** Signature of a known TI function */
export interface TiKnownSignature {
  name: string;
  minParams: number;
  maxParams: number; // Infinity for variadic functions
  params: TiParamInfo[];
  returnType: 'string' | 'numeric' | 'void';
  /** Short description of the function (for SignatureHelp + completion hover) */
  description?: string;
  /** Optional link to IBM docs or another external reference; the v11 (2.1.0) page for IBM links */
  docUrl?: string;
  /** The same page for v12 (3.1.0); falls back to the v11 page where 3.1.0 has none */
  docUrlV12?: string;
  /**
   * NOT a function, but a built-in TI variable: it is ASSIGNED,
   * not called — `DatasourceNameForServer = 'datei.csv';`. TM1 rejects it
   * with parentheses.
   *
   * Measured live (2026-08-30, both servers): readable without a prior assignment,
   * whereas an unknown name fails on exactly that. These entries therefore
   * carry zero parameters; `returnType` is the type of the value.
   */
  assignable?: boolean;

  /** true if the function is no longer available in TM1 / Planning Analytics v12 (Cloud Native) */
  deprecatedInV12?: boolean;
  /**
   * Name of the function that takes its place in v12 — set only where IBM names a concrete
   * replacement. Deliberately only a hint and not a quick fix: from `ExecuteCommand` (shell) to
   * `ExecuteHttpRequest` (HTTP) the arguments cannot be translated mechanically.
   */
  v12Replacement?: string;
  /**
   * true if the function exists ONLY from TM1 / Planning Analytics v12 on — the opposite direction
   * to `deprecatedInV12`. On an 11.x server it is hidden from completion,
   * because a suggestion that does not compile there is worse than none at all.
   *
   * The flag is set only on functions for which THREE independent sources say the same
   * (all measured live on 2026-08-23):
   *  1. 11.8 rejects the call behind `IF(1=0)` with `Aborted` — in every arity 0..4 and
   *     in both forms (tiFunctionExistenceProbe.js).
   *  2. Cubewise's function library lists them as `v12`. A counter-check ran along: NO
   *     function that compiles on 11.8 is listed there as v12-only.
   *  3. On the v12 test server all nine compile (witness + counter-witness + control
   *     `CellGetN` ran in the same window).
   * The third point is the important one: a "does not compile" alone can also be a wrongly
   * stored signature. Only the counter-run separates "does not exist here" from
   * "we call it wrongly".
   */
  v12Only?: boolean;
  /**
   * true if the function is valid ONLY in rules and does not compile in TurboIntegrator processes
   * (e.g. ISLEAF, CellValueN/S, Hierarchy*, UNDEF family). Hidden from
   * TI process completion, but offered in the rule editor.
   */
  rulesOnly?: boolean;
  /**
   * Performance hint: recommendation in which section the function should ideally appear.
   * Emitted as a `performance-hint` when the function appears outside the recommended section.
   */
  performanceNote?: { recommended: TiSection; reason: string };
}

/**
 * Language segments IBM actually serves for the Planning Analytics docs.
 *
 * Measured against the live site on 2026-08-07 (`?topic=functions-roundp`):
 * `de fr es it ja ko zh pt-br` return translated pages, `ru nl` return HTTP 200
 * with English content — and an unknown segment returns **HTTP 404**. The VS Code
 * display language therefore cannot be passed through blindly; `tr`, `pl`, `cs`
 * and friends would produce dead links.
 */
export const IBM_DOC_LANGUAGES: ReadonlySet<string> = new Set([
  'en', 'de', 'fr', 'es', 'it', 'ja', 'ko', 'zh', 'pt-br', 'ru', 'nl',
]);

/** VS Code codes whose base form differs from what IBM serves. */
const IBM_DOC_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh', 'pt': 'pt-br',
};

/**
 * Languages served under 2.1.0 and 3.1.0 as well. Measured 2026-10-07 at `?topic=functions-roundp`:
 * de, fr, es, it, ja, ko exist only under 2.0.0 and redirect to the doc root on the newer
 * versions; zh, pt-br, ru stay translated. Those six get English on the current pages.
 */
const IBM_DOC_LANGUAGES_CURRENT: ReadonlySet<string> = new Set(['en', 'zh', 'pt-br', 'ru']);

let _docLang = 'en';

/**
 * Sets the language used for generated IBM doc links. Call BEFORE
 * `initKnownSignatures()` — the URLs are baked onto the signatures there.
 * Anything unsupported silently falls back to English.
 */
export function setIbmDocLanguage(lang: string | undefined): void {
  _docLang = normalizeIbmDocLanguage(lang);
}

function normalizeIbmDocLanguage(lang: string | undefined): string {
  if (!lang) { return 'en'; }
  const lower = lang.toLowerCase();
  const aliased = IBM_DOC_LANGUAGE_ALIASES[lower];
  if (aliased) { return aliased; }
  if (IBM_DOC_LANGUAGES.has(lower)) { return lower; }
  // Regional variant of a served language, e.g. de-CH → de.
  const base = lower.split('-')[0];
  return IBM_DOC_LANGUAGES.has(base) ? base : 'en';
}

/**
 * Builds the IBM doc URLs for a TI function in the configured language: the v11 page (2.1.0)
 * and the v12 page (3.1.0), each falling back to the other line where IBM has only one.
 * Example: `CellGetN` → `https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-cellgetn`
 * Pages that differ from `functions-<name>` come from the measured table in `ibmDocPages.ts`.
 */
export function buildIbmDocUrls(funcName: string): { docUrl?: string; docUrlV12?: string } {
  const slug = funcName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (IBM_DOC_NONE.has(slug)) { return {}; }
  const [v11, v12] = IBM_DOC_PAGES[slug]
    ?? [`2.1.0?topic=functions-${slug}`, `3.1.0?topic=functions-${slug}`];
  const url = (path: string | null): string | undefined => {
    if (!path) { return undefined; }
    const lang = path.startsWith('2.0.0') || IBM_DOC_LANGUAGES_CURRENT.has(_docLang) ? _docLang : 'en';
    return `https://www.ibm.com/docs/${lang}/planning-analytics/${path}`;
  };
  const docUrl = url(v11 ?? v12);
  const docUrlV12 = url(v12 ?? v11);
  return { docUrl, docUrlV12 };
}

/** The doc link that matches the server line the user is working against. */
export function docUrlFor(sig: { docUrl?: string; docUrlV12?: string }, v12: boolean): string | undefined {
  return v12 ? sig.docUrlV12 ?? sig.docUrl : sig.docUrl;
}

/**
 * Map of all known TI function signatures.
 * Key is the function name in lowercase for case-insensitive lookup.
 *
 * **Starts EMPTY** — populated lazily via `initKnownSignatures()` below:
 *   - extension host: from `media/tiSignatures.json` at activate() (extension.ts).
 *   - webviews:       from inline JSON at boot (_shared/sigsBootstrap.ts).
 *   - tests:          from real JSON file at vitest setup (src/test/setup.ts).
 *
 * Data lives in per-category JSON files under `signatures/` → built via
 * `npm run build:signatures` → emits `media/tiSignatures.json` (runtime
 * asset). No TS-array intermediate any more (removed in Phase 4 of split).
 */
export const KNOWN_SIGNATURES: Map<string, TiKnownSignature> = new Map();

/**
 * Idempotent re-init of the global signature Map from a raw entry array
 * (e.g. parsed from `media/tiSignatures.json` by `tiSignaturesLoader.ts`).
 *
 * Used by the extension activation path and webview boot to load signatures
 * from the JSON asset instead of the bundled TS array.
 *
 * Safe to call multiple times — clears existing entries first, then re-applies
 * `signatureDocs.ts` descriptions and IBM-doc URL fallbacks.
 */
export function initKnownSignatures(
  entries: ReadonlyArray<readonly [string, TiKnownSignature]>,
): void {
  KNOWN_SIGNATURES.clear();
  for (const [k, v] of entries) {
    KNOWN_SIGNATURES.set(k, v);
  }
  applySignatureDocs(KNOWN_SIGNATURES, buildIbmDocUrls);
}
