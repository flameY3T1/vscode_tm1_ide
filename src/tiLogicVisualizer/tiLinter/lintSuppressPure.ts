/**
 * Line-by-line suppression of lint findings via a comment.
 *
 * Up to now a rule could only be switched off GLOBALLY (gear menu, `tm1.lintConfig`).
 * Anyone with a single deliberate spot — the one `ExecuteCommand`, the one
 * intentionally hard-coded path — had to switch the rule off for the whole server
 * and thereby also lost it where it is meant to apply.
 *
 * Two forms, both in the TI comment (`#`):
 *
 * ```ti
 * ExecuteCommand( sCmd, 1 );   # tm1lint: disable=exec-command-forbidden
 *
 * # tm1lint: disable-next-line=hardcoded-path
 * sPfad = 'C:\\temp\\x.csv';
 * ```
 *
 * Without a rule list (`# tm1lint: disable`) the line is silenced completely. Several
 * rules separated by commas. Case does not matter, spaces around `:` and `=`
 * are allowed, `tm1lint:disable` without a space too.
 *
 * Deliberately NO file-wide `disable`: that is the state the
 * gear menu already represents, and a second place for it would only be a
 * second truth.
 */

/** Line number (0-based) → suppressed ruleIds, or `'all'` for all. */
export type SuppressionMap = Map<number, Set<string> | 'all'>;

/**
 * Blanks out strings so that a `#` INSIDE them does not start a comment.
 * The length is preserved — columns do not matter here, but this way the
 * line stays congruent with the original if someone later needs columns
 * after all.
 */
function blankStrings(line: string): string {
  return line
    .replace(/'[^']*'/g, s => ' '.repeat(s.length))
    .replace(/"[^"]*"/g, s => ' '.repeat(s.length));
}

const DIRECTIVE_RE = /#\s*tm1lint\s*:\s*(disable-next-line|disable)\s*(?:=\s*([^#]*))?/i;

function parseIds(raw: string | undefined): Set<string> | 'all' {
  const list = (raw ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
  return list.length === 0 ? 'all' : new Set(list);
}

function merge(target: SuppressionMap, line: number, add: Set<string> | 'all'): void {
  const existing = target.get(line);
  if (existing === 'all' || add === 'all') { target.set(line, 'all'); return; }
  if (!existing) { target.set(line, new Set(add)); return; }
  for (const id of add) { existing.add(id); }
}

/**
 * Reads the suppressions from the source text. Lines are 0-based, matching
 * `vscode.Range`; whoever has 1-based diagnostic lines subtracts one first.
 */
export function parseLintSuppressions(code: string): SuppressionMap {
  const result: SuppressionMap = new Map();
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = DIRECTIVE_RE.exec(blankStrings(lines[i]));
    if (!m) { continue; }
    const ids = parseIds(m[2]);
    merge(result, m[1].toLowerCase() === 'disable-next-line' ? i + 1 : i, ids);
  }
  return result;
}

/** Is this finding suppressed on this line (0-based)? */
export function isLintSuppressed(map: SuppressionMap, line0: number, ruleId: string): boolean {
  const entry = map.get(line0);
  if (!entry) { return false; }
  return entry === 'all' || entry.has(ruleId.toLowerCase());
}

/**
 * Filters a list of findings. `lineOf` returns the 0-based line, `ruleIdOf`
 * the rule — so the same filter fits the plain `LintDiagnose` (line
 * 1-based) as well as finished `vscode.Diagnostic` (line 0-based), without
 * this module having to know `vscode`.
 */
export function filterSuppressed<T>(
  items: readonly T[],
  map: SuppressionMap,
  lineOf: (item: T) => number,
  ruleIdOf: (item: T) => string | undefined,
): T[] {
  if (map.size === 0) { return [...items]; }
  return items.filter(item => {
    const ruleId = ruleIdOf(item);
    if (!ruleId) { return true; }
    return !isLintSuppressed(map, lineOf(item), ruleId);
  });
}
