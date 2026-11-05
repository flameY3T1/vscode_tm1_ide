import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { fetchServerLanguage } from '../tm1Rest/serverLanguageApi';
import { classifyLogLanguage } from './serverLanguagePure';

/**
 * The sentence that the start-run and run analysis display when the server
 * language is neither English nor German — and ONLY then.
 *
 * Without it, the case cannot be reported: the patterns do not match, the
 * analysis shows a dash, and the user reads that as "this server had no
 * runs" instead of "this view cannot handle the language". The hint is tied
 * to the language, not to an empty result: a French server on which a line
 * happens to match should get it just the same.
 *
 * Each server is asked once per session. The language lives in `tm1s.cfg`
 * and only changes with a server restart; a fetch on every panel open would
 * be pure load. What is stored is the PROMISE, not its result — two panels
 * that open at the same time share one fetch this way instead of starting
 * two.
 */
const cache = new Map<string, Promise<string | undefined>>();

/** Discard what is remembered for this server (disconnect, profile deleted). */
export function clearLanguageHintCache(serverUrl: string): void {
  cache.delete(serverUrl);
}

/** Tests only. */
export function _clearLanguageHintCacheForTest(): void {
  cache.clear();
}

async function computeHint(cfg: Tm1Config): Promise<string | undefined> {
  const lang = await fetchServerLanguage(cfg);
  // `unknown` (language leaf missing, fetch rejected, v12) stays silent:
  // turning a knowledge gap into a warning would complain about every server
  // that does not show us its configuration.
  if (classifyLogLanguage(lang) !== 'unsupported') { return undefined; }
  return vscode.l10n.t(
    'Server language "{0}": this analysis reads only the English and German wording of the TM1 message log, so runs on this server are not recognized.',
    lang ?? '',
  );
}

/**
 * The hint text, or `undefined` when none is needed.
 *
 * Never throws — the caller wanted a hint and must not get a second source
 * of errors for it.
 */
export function messageLogLanguageHint(cfg: Tm1Config): Promise<string | undefined> {
  const key = cfg.serverUrl;
  const known = cache.get(key);
  if (known) { return known; }
  const pending = computeHint(cfg).catch(() => undefined);
  cache.set(key, pending);
  return pending;
}
