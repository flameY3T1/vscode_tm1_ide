/**
 * Language chain for language-dependent stores — vscode-free, without imports.
 *
 * VS Code liefert die Anzeigesprache teils mit Region (`pt-br`, `zh-cn`), teils
 * without (`de`, `fr`). Our translations can live on either level,
 * so this function lists the steps from most specific to coarsest
 * and leaves English OUT: English is the source and always the caller's last
 * fallback, not a translation state of its own.
 *
 * Zwei Lader benutzen die Kette (`tiSignaturesNodeBoot` im Host,
 * `utils/sigsAsset` for the webview). Until 2026-08-31 both had their
 * own `startsWith('de')` — with a second language both would have silently fallen back to
 * English, independently of each other.
 *
 * @example localeChain('pt-BR') // ['pt-br', 'pt']
 * @example localeChain('de')    // ['de']
 * @example localeChain('en-US') // []  — English is the source
 */
export function localeChain(locale: string | undefined): string[] {
  const lower = (locale ?? '').trim().toLowerCase();
  if (!lower) { return []; }
  const base = lower.split(/[-_]/)[0];
  // Base `en` empties the WHOLE chain, not just the `en` step: for `en-us`
  // there is no translation, English IS the source. A plain
  // `filter(l => l !== 'en')` would leave `en-us` in place and the loader would look for a
  // file that will never exist.
  if (base === 'en') { return []; }
  return [...new Set([lower, base])].filter((l) => l !== '');
}

/**
 * File names of a language-dependent store, most specific first, the English
 * source last: `localeAssetNames('tiSignatureDocs', 'json', 'pt-br')` yields
 * `tiSignatureDocs.pt-br.json`, `tiSignatureDocs.pt.json`,
 * `tiSignatureDocs.json`.
 */
export function localeAssetNames(stem: string, ext: string, locale: string | undefined): string[] {
  return [...localeChain(locale).map((l) => `${stem}.${l}.${ext}`), `${stem}.${ext}`];
}
