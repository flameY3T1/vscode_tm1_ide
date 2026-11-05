/**
 * Version comparison for TI functions — both directions, one source.
 *
 * TM1 11.x and v12 have separate function inventories. Until 2026-08-31 the
 * extension checked only ONE direction (functions removed in v12), and that only
 * in the file check — in the process editor, where most TI work happens,
 * it never fired, although the gear menu has always offered the rule `v12-deprecated`
 * for switching off. This module closes both gaps by being called from both
 * surfaces.
 *
 * The name lists come from `tiSignatures.ts` (`deprecatedInV12` / `v12Only`)
 * — they are maintained there and only there.
 *
 * Pure text scan, no AST: the names are unambiguous enough, and this way the
 * check also applies in sections whose AST got stuck on a parse error.
 */
import { KNOWN_SIGNATURES } from '../tiSignatures';

/** Which edition is being checked against. */
export type VersionTarget = 'v11' | 'v12';

export type VersionCompatKind = 'deprecated-in-v12' | 'v12-only';

export interface VersionCompatHit {
  /** 0-based, like the line counting of vscode.Range. */
  line: number;
  startCol: number;
  endCol: number;
  /** Name in the spelling of the signature, not that of the source text. */
  name: string;
  kind: VersionCompatKind;
  /** Only for `deprecated-in-v12` and only if IBM names a successor. */
  replacement?: string;
}

/** Map: lowercase name → original spelling, for functions removed in v12. */
export const V12_DEPRECATED: Map<string, string> = new Map(
  [...KNOWN_SIGNATURES.entries()]
    .filter(([, sig]) => sig.deprecatedInV12)
    .map(([key, sig]) => [key, sig.name]),
);

/** Map: lowercase name → v12 successor, where IBM names one. */
export const V12_REPLACEMENTS: Map<string, string> = new Map(
  [...KNOWN_SIGNATURES.entries()]
    .filter(([, sig]) => sig.deprecatedInV12 && sig.v12Replacement)
    .map(([key, sig]) => [key, sig.v12Replacement as string]),
);

/** Map: lowercase name → original spelling, for functions that exist only from v12. */
export const V12_ONLY: Map<string, string> = new Map(
  [...KNOWN_SIGNATURES.entries()]
    .filter(([, sig]) => sig.v12Only)
    .map(([key, sig]) => [key, sig.name]),
);

/**
 * Builds the search pattern for a name list.
 *
 * Word boundary instead of an opening parenthesis: TI makes the parentheses
 * optional for a call without arguments (`SaveDataAll;`), and the data source
 * pseudo-variables are assigned instead of called. A pattern with `\s*\(` let 17 of the 48
 * removed names slip through completely (measured 2026-08-31).
 *
 * Longest names first, because the alternation is first-match and
 * `BatchUpdateFinish` is a prefix of `BatchUpdateFinishWait`. The
 * trailing word boundary catches the backtracking case anyway — the
 * sorting makes it independent of the order in `KNOWN_SIGNATURES`.
 */
function buildPattern(names: Iterable<string>): RegExp | null {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) { return null; }
  return new RegExp(`\\b(${sorted.join('|')})\\b`, 'gi');
}

let _deprecatedPattern: RegExp | null | undefined;
let _v12OnlyPattern: RegExp | null | undefined;

function deprecatedPattern(): RegExp | null {
  if (_deprecatedPattern === undefined) { _deprecatedPattern = buildPattern(V12_DEPRECATED.keys()); }
  return _deprecatedPattern;
}

function v12OnlyPattern(): RegExp | null {
  if (_v12OnlyPattern === undefined) { _v12OnlyPattern = buildPattern(V12_ONLY.keys()); }
  return _v12OnlyPattern;
}

/**
 * Blanks out everything that is not code: both kinds of strings and the
 * rest of the comment from `#`. The length is preserved so that the columns match.
 *
 * Double quotes have to go too, now that the parenthesis is no longer
 * required: a .pro header line (`602,"SaveDataAll"`) carries the name as a
 * string and would otherwise be a hit.
 */
export function stripNonCode(line: string): string {
  return line
    .replace(/'[^']*'/g, s => ' '.repeat(s.length))
    .replace(/"[^"]*"/g, s => ' '.repeat(s.length))
    .replace(/#.*$/, '');
}

function scan(
  text: string,
  pattern: RegExp,
  names: Map<string, string>,
  kind: VersionCompatKind,
): VersionCompatHit[] {
  const lines = text.split('\n');
  const result: VersionCompatHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripNonCode(lines[i]);
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) {
      const lower = m[1].toLowerCase();
      const name = names.get(lower) ?? m[1];
      const hit: VersionCompatHit = {
        line: i,
        startCol: m.index,
        endCol: m.index + name.length,
        name,
        kind,
      };
      const replacement = kind === 'deprecated-in-v12' ? V12_REPLACEMENTS.get(lower) : undefined;
      if (replacement) { hit.replacement = replacement; }
      result.push(hit);
    }
  }
  return result;
}

/**
 * Finds function calls that do not fit the target edition.
 *
 * - Target `v12`: functions removed in v12 (`deprecated-in-v12`).
 * - Target `v11`: functions that exist only from v12 on (`v12-only`) — on 11.x
 *   they fail at runtime, and completion has hidden them there
 *   for a while already. Only the diagnostic was missing.
 */
export function findVersionIncompatibleCalls(text: string, target: VersionTarget): VersionCompatHit[] {
  if (target === 'v12') {
    const pattern = deprecatedPattern();
    return pattern ? scan(text, pattern, V12_DEPRECATED, 'deprecated-in-v12') : [];
  }
  const pattern = v12OnlyPattern();
  return pattern ? scan(text, pattern, V12_ONLY, 'v12-only') : [];
}
