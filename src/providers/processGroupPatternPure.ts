/**
 * Pure pattern compiler for the process-grouping modes `patternPrefix` /
 * `patternSuffix`. No vscode dependency — unit-testable and importable from
 * the webview bundle (live preview in the grouping panel).
 *
 * The literal modes (`prefix`/`suffix`, see `processGrouping.ts`) cannot group
 * number ranges: `s001_…`, `s002_… `, … each need their own token, and a
 * shortened token like `s` turns every process into its own group. A pattern
 * describes the *shape* of the grouping part instead, and the matched text
 * becomes the group key — so `s{n}_` yields the groups `s001_`, `s002_`, …
 * without listing them.
 *
 * Grammar — everything is literal except placeholders in braces, so a marker
 * like `####` keeps working as plain text:
 *
 *   {n}      1+ digits                  {n:3}  exactly 3 digits
 *   {a}      1+ letters/digits          {a:3}  exactly 3 letters/digits
 *   {*}      1+ arbitrary characters (lazy — stops at the next literal part)
 *   {{       a literal `{`
 *
 * Errors carry a code + argument instead of a message: the module is
 * vscode-free, so the caller (panel/webview) localizes.
 */

export type PatternAnchor = 'start' | 'end';

/** Error codes returned by `compileProcessGroupPattern`. */
export type PatternErrorCode =
  /** A `{` without a closing `}`. */
  | 'unclosed'
  /** Brace content is not a known placeholder (`arg` = the raw content). */
  | 'unknownPlaceholder'
  /** Placeholder is empty (`{}`). */
  | 'empty';

export type PatternCompileResult =
  | { ok: true; regex: RegExp }
  | { ok: false; code: PatternErrorCode; arg?: string };

/** Characters that must be escaped to appear literally in a RegExp. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeLiteral(ch: string): string {
  return ch.replace(REGEX_SPECIAL, '\\$&');
}

/**
 * Translate the content between braces into a regex fragment.
 * Returns `null` for unknown placeholders (caller reports `unknownPlaceholder`).
 */
function placeholderToRegex(spec: string): string | null {
  const m = /^([na*])(?::(\d{1,2}))?$/.exec(spec);
  if (!m) { return null; }
  const kind = m[1];
  const count = m[2];
  if (kind === '*') {
    // `{*:n}` is meaningless — a fixed-length "anything" would just be `.{n}`,
    // which the grammar deliberately does not offer (too easy to mis-group).
    return count ? null : '.+?';
  }
  const atom = kind === 'n' ? '\\d' : '[A-Za-z0-9]';
  if (!count) { return `${atom}+`; }
  const n = Number(count);
  if (n < 1) { return null; }
  return `${atom}{${n}}`;
}

/**
 * Compile a grouping pattern into an anchored RegExp.
 *
 * `anchor: 'start'` matches at the beginning of a process name (prefix
 * pattern), `'end'` at its end (postfix pattern). The whole match (`m[0]`) is
 * the group key — see `extractPatternKey`.
 *
 * An empty pattern compiles to a regex that matches everything at the anchor;
 * callers treat an empty token as "no grouping" *before* compiling, so this
 * case never reaches the tree.
 */
export function compileProcessGroupPattern(
  pattern: string,
  anchor: PatternAnchor,
): PatternCompileResult {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '{') {
      if (pattern[i + 1] === '{') { out += '\\{'; i += 2; continue; }
      const end = pattern.indexOf('}', i + 1);
      if (end < 0) { return { ok: false, code: 'unclosed' }; }
      const spec = pattern.slice(i + 1, end);
      if (spec.length === 0) { return { ok: false, code: 'empty' }; }
      const frag = placeholderToRegex(spec);
      if (frag === null) { return { ok: false, code: 'unknownPlaceholder', arg: spec }; }
      out += frag;
      i = end + 1;
      continue;
    }
    out += escapeLiteral(ch);
    i++;
  }
  const source = anchor === 'start' ? `^(?:${out})` : `(?:${out})$`;
  try {
    return { ok: true, regex: new RegExp(source) };
  } catch {
    // Defensive: every fragment above is already valid regex, so this is
    // unreachable in practice — but a throw here would kill the tree refresh.
    return { ok: false, code: 'unknownPlaceholder', arg: pattern };
  }
}

/** Group key for `name`, or `null` when the pattern does not match. */
export function extractPatternKey(name: string, regex: RegExp): string | null {
  const m = regex.exec(name);
  return m ? m[0] : null;
}
