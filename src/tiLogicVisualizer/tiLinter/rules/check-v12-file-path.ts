import { LintDiagnose } from '../../lintTypes';
import type { LintOptions } from '../types';

/**
 * TI file functions that in TM1 12 only reach the database content directory and its
 * children (IBM, "Changed features and components in TM1 12").
 */
export const V12_FILE_FUNCTIONS = [
  'AsciiDelete', 'AsciiOutput', 'AsciiOutputOpen', 'FileExists',
  'SetOutputEscapeDoubleQuote', 'TextOutput', 'WildcardFileSearch',
];

/** Function name plus its first single-quoted argument — the file path for all of them. */
const CALL_RE = new RegExp(`\\b(${V12_FILE_FUNCTIONS.join('|')})\\s*\\(\\s*'([^']*)'`, 'gi');

/**
 * A path that leaves the content directory: a drive letter (`C:\…`), a UNC share (`\\host\…`)
 * or a parent traversal (`../x.csv`).
 *
 * Measured on the v12 test server 2026-08-09, AsciiOutput in the prolog:
 *   'zz.csv'         → CompletedSuccessfully
 *   'C:\temp\zz.csv' → Aborted
 *   '../zz.csv'      → Aborted
 *   '/tmp/zz.csv'    → CompletedSuccessfully  ← NOT flagged
 *
 * A leading slash resolves inside the container instead of failing, so flagging it would warn
 * about working code.
 *
 * `hardcoded-path` also reports drive letters and UNC paths, but it argues portability
 * ("pass it in as a TI parameter"). On v12 the stronger fact is that the call aborts, so this
 * rule supersedes it on that line rather than stacking a second squiggle next to it.
 */
export const ESCAPES_CONTENT_DIR = /^[A-Za-z]:[\\/]|^\\\\|(^|[\\/])\.\.([\\/]|$)/;

/**
 * Post-traversal check: emit `v12-file-path` where a file function climbs out of the content
 * directory. Silent unless V12 mode is on — on 11.x the path is legal.
 */
export function checkV12FilePaths(
  rawCode: string | undefined,
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  if (!rawCode || !options?.v12Mode) { return; }
  const lines = rawCode.split('\n');
  const superseded = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '');
    CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL_RE.exec(line)) !== null) {
      if (!ESCAPES_CONTENT_DIR.test(m[2])) { continue; }
      superseded.add(i + 1);
      diagnostics.push({
        line: i + 1,
        severity: 'warning',
        ruleId: 'v12-file-path',
        messageKey: `{0}() only reaches the database content directory in TM1 / Planning Analytics v12 — '{1}' climbs out of it.`,
        messageArgs: [m[1], m[2]],
      });
    }
  }
  if (superseded.size === 0) { return; }
  // Drop the portability warning where the v12 one already says something stronger about the
  // same line. `hardcoded-path` emits at most one diagnostic per line, so this cannot swallow
  // a second, unrelated finding on it.
  for (let i = diagnostics.length - 1; i >= 0; i--) {
    const d = diagnostics[i];
    if (d.ruleId === 'hardcoded-path' && superseded.has(d.line)) { diagnostics.splice(i, 1); }
  }
}
