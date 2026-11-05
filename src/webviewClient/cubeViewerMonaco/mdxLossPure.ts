// Pure heuristic: if the original MDX contained calculated members / WITH clauses
// that the grid-regenerated (pivoted) MDX string does not represent, they are
// lost on overwrite. Single backslash - real webview JS.
const CALC_RE = /\bWITH\b|\bMEMBER\b|\bSET\b/i;

export function mdxMayLoseContent(
  originalMdx: string | null | undefined,
  savingMdx: string,
): boolean {
  if (!originalMdx) { return false; }
  if (originalMdx.trim() === savingMdx.trim()) { return false; }
  // Strip [bracketed] member/dim names first — WITH/MEMBER/SET only carry
  // meaning as MDX keywords outside brackets, so a name like [Set01] must
  // not trigger a spurious loss warning.
  const withoutNames = originalMdx.replace(/\[[^\]]*\]/g, '');
  return CALC_RE.test(withoutNames);
}
