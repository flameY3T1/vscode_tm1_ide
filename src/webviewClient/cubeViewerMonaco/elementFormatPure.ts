/**
 * The element attribute `Format` — the server's own, permanent number format
 * of an element. A different language than the MDX `FORMAT_STRING`, measured
 * on 11.8 (2026-09-27, every letter a–z, 8 pattern kinds):
 *
 *  - `b:` and `c:` apply the pattern exactly like `FORMAT_STRING` (sections,
 *    `(…)`, `"€"`, `%`, scaling commas, dates, `E+00`).
 *  - `d:` only works for plain patterns: quoted text comes out with its quotes,
 *    scaling commas, a zero section and dates render "error".
 *  - any other letter, no prefix, `Standard`: silently ignored (default rendering).
 *  - REST strips ANY one-letter prefix when reading `Attributes` — only the
 *    cell in `}ElementAttributes_<dim>` shows what really is stored.
 */

export type AttrFormatStatus =
  /** Nothing stored. */
  | 'none'
  /** `b:`/`c:` — applies as written. */
  | 'ok'
  /** `d:` with a plain pattern — applies. */
  | 'okLegacy'
  /** `d:` with quotes/scaling/zero section/date — TM1 shows "error" or quotes. */
  | 'legacyBreaks'
  /** No prefix or an unknown one — TM1 ignores it. */
  | 'ignored';

export interface AttrFormat { prefix: string | null; pattern: string }

export function splitAttrFormat(raw: string): AttrFormat {
  const m = /^([A-Za-z]):(.*)$/s.exec(raw);
  return m ? { prefix: m[1].toLowerCase(), pattern: m[2] } : { prefix: null, pattern: raw };
}

/** Constructs `d:` breaks on (measured). */
function breaksUnderD(pattern: string): boolean {
  const plain = pattern.replace(/"[^"]*"/g, 'Q');
  return pattern.includes('"')
    || /[0#],(?![0#])/.test(plain)
    || plain.split(';').length >= 3
    || /[dy]/i.test(plain.replace(/E[+-]/gi, ''));
}

export function attrFormatStatus(raw: string | null | undefined): AttrFormatStatus {
  if (!raw) { return 'none'; }
  const { prefix, pattern } = splitAttrFormat(raw);
  if (!pattern) { return prefix ? 'ignored' : 'none'; }
  if (prefix === 'b' || prefix === 'c') { return 'ok'; }
  if (prefix === 'd') { return breaksUnderD(pattern) ? 'legacyBreaks' : 'okLegacy'; }
  return 'ignored';
}

/** What to store for `pattern`: keep a working `c:`, otherwise `b:` (`d:`
 *  would break on half the patterns the dialog builds). */
export function composeAttrFormat(pattern: string, existingRaw?: string | null): string {
  const keep = existingRaw ? splitAttrFormat(existingRaw).prefix : null;
  return `${keep === 'c' ? 'c' : 'b'}:${pattern}`;
}

/** `}ElementAttributes_<dim>` → `<dim>`, else null. */
export function attrCubeDimension(cubeName: string): string | null {
  const m = /^\}ElementAttributes_(.+)$/.exec(cubeName);
  return m ? m[1] : null;
}
