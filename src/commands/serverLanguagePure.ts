/**
 * Does the server language carry the message-log analyses? Pure logic, no
 * dependencies.
 *
 * The startup and run analyses read the message log via text patterns, and
 * every pattern is written as a pair — English AND German (`elapsed time` /
 * `verstrichene Zeit`, `Prozess "x": Ausfuehrung normal beendet` /
 * `finished executing normally`). Both spellings are measured on real
 * servers; a German 11.8 instance even mixes them within a single file,
 * because IBM only translated part of it.
 *
 * Every THIRD language falls through silently: no pattern matches, the
 * analysis shows a dash, and that is indistinguishable from "this server had
 * no runs". Resolving exactly this indistinguishability is what the hint
 * `classifyLogLanguage` triggers is for.
 */

export type LogLanguageSupport = 'supported' | 'unsupported' | 'unknown';

/**
 * Language tags whose spelling the patterns know.
 *
 * Two lengths on purpose: `tm1s.cfg` carries the three-letter form
 * (`Language=eng`), while the REST interface's description of the parameter
 * names the two-letter one instead (`EN`, `DE`, `FR`). Which one the server
 * returns is up to the server — so accept both instead of guessing one.
 */
const SUPPORTED_TAGS: ReadonlySet<string> = new Set([
  'en', 'eng', 'english',
  'de', 'ger', 'deu', 'german',
]);

/**
 * Trim down to the bare language part: lowercase, region suffix removed
 * (`de-DE`, `en_US`), surrounding whitespace removed.
 *
 * The region suffix drops out because it changes nothing about the wording
 * in the log — a `de-AT` server writes the same German messages as a
 * `de-DE` server.
 */
export function normalizeLanguageTag(raw: string | undefined | null): string {
  if (typeof raw !== 'string') { return ''; }
  return raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * `unknown` is explicitly NOT a warning case: it means "we could not read
 * the language" (setting missing, request rejected, old server), not "the
 * language does not fit". Turning a knowledge gap into a warning would mean
 * nagging every server that does not show us its configuration.
 */
export function classifyLogLanguage(raw: string | undefined | null): LogLanguageSupport {
  const tag = normalizeLanguageTag(raw);
  if (tag === '') { return 'unknown'; }
  return SUPPORTED_TAGS.has(tag) ? 'supported' : 'unsupported';
}
