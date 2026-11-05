import type { ValueGroup } from './types';
import type { MultiValueVar } from '../tiLiveRange/types';

/** Trim, drop empties, dedupe case-insensitively (first spelling wins, order preserved). */
export function normalizeExcludes(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entries) {
    const e = raw.trim();
    if (!e) { continue; }
    const lc = e.toLowerCase();
    if (seen.has(lc)) { continue; }
    seen.add(lc);
    out.push(e);
  }
  return out;
}

/** Linear (non-backtracking) glob match — `*` matches any run, every other
 *  char is a literal. Both args must already be lowercase. O(n·m) worst case,
 *  so it is ReDoS-proof (a compiled-regex `.*.*…` would backtrack
 *  catastrophically and freeze the extension host). */
function globMatch(pat: string, s: string): boolean {
  let pi = 0, si = 0, star = -1, mark = 0;
  while (si < s.length) {
    if (pi < pat.length && pat[pi] === '*') { star = pi++; mark = si; }
    else if (pi < pat.length && pat[pi] === s[si]) { pi++; si++; }
    else if (star !== -1) { pi = star + 1; si = ++mark; }
    else { return false; }
  }
  while (pi < pat.length && pat[pi] === '*') { pi++; }
  return pi === pat.length;
}

/** Compile glob entries (only `*` is a wildcard) into a case-insensitive
 *  predicate over a variable name. Plain entries match exactly. Uses a linear
 *  matcher, not `new RegExp`, so pathological entries like `a*a*…*b` cannot
 *  cause catastrophic backtracking. */
export function compileExcludes(entries: string[]): (nameLc: string) => boolean {
  const pats: string[] = [];
  for (const raw of entries) {
    const e = raw.trim().toLowerCase();
    if (e) { pats.push(e); }
  }
  if (!pats.length) { return () => false; }
  return (nameLc: string) => pats.some(p => globMatch(p, nameLc));
}

/** Removes excluded variable names from both result sets.
 *  - Value groups: drop matching names; drop the group if < 2 names remain
 *    (a divergence needs >= 2, see scan.ts); recompute canonicalSuggestion to
 *    the top remaining (names stay count-desc sorted).
 *  - Multi-value: drop entries whose varLc matches. */
export function applyExclusions(
  groups: ValueGroup[],
  multiValue: MultiValueVar[],
  isExcluded: (nameLc: string) => boolean,
): { groups: ValueGroup[]; multiValue: MultiValueVar[] } {
  const outGroups: ValueGroup[] = [];
  for (const grp of groups) {
    const names = grp.names.filter(n => !isExcluded(n.name.toLowerCase()));
    if (names.length < 2) { continue; }
    outGroups.push({ ...grp, names, canonicalSuggestion: names[0].name });
  }
  const outMulti = multiValue.filter(mv => !isExcluded(mv.varLc));
  return { groups: outGroups, multiValue: outMulti };
}
