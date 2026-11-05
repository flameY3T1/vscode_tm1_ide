/** Pure helpers for debug.ts — no monaco/dom dependencies. */

export type { SectionKey } from './sectionTypes';
import type { SectionKey } from './sectionTypes';

/**
 * Normalize a raw section identifier (e.g. legacy capitalized `'Prolog'`,
 * `'METADATA'`) to the canonical lowercase form.
 *
 * Returns `undefined` for anything unrecognized — including missing input. It
 * used to fall back to `'prolog'`, which silently switched the editor to the
 * Prolog tab and highlighted a line the process was not on whenever the server
 * reported no position. Callers must treat `undefined` as "position unknown":
 * no section switch, no highlight.
 */
export function normalizeSection(raw: unknown): SectionKey | undefined {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'prolog' || s === 'metadata' || s === 'data' || s === 'epilog') { return s as SectionKey; }
  return undefined;
}
