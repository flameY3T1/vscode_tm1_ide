// src/webviewClient/cellTrace/ruleLines.ts
// Pure statement→line matcher. No DOM/vscode — used by the cellTrace webview
// client AND a node test. Matches a trace statement (returned by
// TraceCellCalculation/TraceFeeders as text-only, no line number) against the
// cube's Rules source text by whitespace-normalized comparison.

export function normStmt(s: string): string {
  return s.replace(/\s+/g, '');
}

/** Line number (1-based) of `statement` within `rulesText`, or null if not found.
 *  Matches on whitespace-normalized text; falls back to a multi-line window for
 *  statements split across source lines. */
export function matchStatementLine(rulesText: string, statement: string): number | null {
  const target = normStmt(statement);
  if (!target) { return null; }
  const lines = rulesText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (normStmt(lines[i]) === target) { return i + 1; }
  }
  for (let i = 0; i < lines.length; i++) {
    let acc = '';
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      acc += normStmt(lines[j]);
      if (acc === target) { return i + 1; }
      if (acc.length > target.length) { break; }
    }
  }
  return null;
}
