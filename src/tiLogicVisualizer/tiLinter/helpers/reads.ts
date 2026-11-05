import { TiAst, TiStatement } from '../../types';
import { KNOWN_SIGNATURES } from '../../tiSignatures';
import { BARE_KEYWORDS, TI_KEYWORDS } from '../constants';
import { stripStringLiterals } from './parse';

/** A TI identifier not preceded/followed by another identifier char (so it
 *  matches whole names, incl. German umlauts). Global — use only via `.match()`,
 *  which ignores lastIndex. */
const IDENTIFIER_RE = /(?<![A-Za-zÄÖÜäöüß0-9_])[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*(?![A-Za-zÄÖÜäöüß0-9_])/g;

/**
 * Collect all variable names read in the entire AST (lowercased). A projection
 * of `collectReadsWithLines` so there is a single read-collection engine — the
 * map keys are exactly the read set.
 */
export function collectAllReads(ast: TiAst): Set<string> {
  return new Set(collectReadsWithLines(ast).keys());
}

/**
 * Like collectAllReads, but records the 1-based source line of the FIRST real
 * read of each variable (statement line from the AST — so it skips comments and
 * string literals that merely mention the name). Used to anchor the
 * undefined-variable diagnostic on the actual usage line instead of a lexical
 * first-match that could land on a comment on line 1.
 * Returns Map<lowercaseName, firstLine1Based>.
 */
export function collectReadsWithLines(ast: TiAst): Map<string, number> {
  const reads = new Map<string, number>();

  const add = (expression: string, line: number): void => {
    const stripped = stripStringLiterals(expression);
    const identifiers = stripped.match(IDENTIFIER_RE);
    if (!identifiers) { return; }
    for (const id of identifiers) {
      const lower = id.toLowerCase();
      if (TI_KEYWORDS.has(lower)) { continue; }
      if (KNOWN_SIGNATURES.has(lower)) { continue; }
      if (BARE_KEYWORDS.has(lower)) { continue; }
      if (!reads.has(lower)) { reads.set(lower, line); }
    }
  };

  const walk = (statements: TiStatement[]): void => {
    for (const stmt of statements) {
      switch (stmt.type) {
        case 'assignment':
          add(stmt.expression, stmt.line);
          break;
        case 'functionCall':
          for (const arg of stmt.args) { add(arg, stmt.line); }
          break;
        case 'if':
          add(stmt.condition, stmt.line);
          walk(stmt.thenBody);
          for (const clause of stmt.elseIfClauses) {
            add(clause.condition, clause.line);
            walk(clause.body);
          }
          walk(stmt.elseBody);
          break;
        case 'while':
          add(stmt.condition, stmt.line);
          walk(stmt.body);
          break;
      }
    }
  };

  walk(ast);
  return reads;
}

/**
 * Recursively collect all variable names that are assigned in a list of statements.
 * Returns a Set of lowercase variable names.
 */
export function collectAssignedVariables(statements: TiStatement[]): Set<string> {
  const assigned = new Set<string>();
  for (const stmt of statements) {
    switch (stmt.type) {
      case 'assignment':
        assigned.add(stmt.variable.toLowerCase());
        break;
      case 'if':
        for (const v of collectAssignedVariables(stmt.thenBody)) assigned.add(v);
        for (const clause of stmt.elseIfClauses) {
          for (const v of collectAssignedVariables(clause.body)) assigned.add(v);
        }
        for (const v of collectAssignedVariables(stmt.elseBody)) assigned.add(v);
        break;
      case 'while':
        for (const v of collectAssignedVariables(stmt.body)) assigned.add(v);
        break;
      default: // other statements neither nest nor matter here
        break;
    }
  }
  return assigned;
}

/**
 * Clear entries from lastUnreadAssignment for any variables that are read
 * in the given expression/condition string.
 * Ensures that if a variable is read between two assignments,
 * the first assignment is NOT flagged as a dead store.
 */
export function clearReadsFromExpression(
  expression: string,
  lastUnreadAssignment: Map<string, number>,
): void {
  const identifiers = expression.match(IDENTIFIER_RE);
  if (!identifiers) return;

  for (const id of identifiers) {
    const lower = id.toLowerCase();
    if (TI_KEYWORDS.has(lower)) continue;
    if (KNOWN_SIGNATURES.has(lower)) continue;
    if (BARE_KEYWORDS.has(lower)) continue;
    lastUnreadAssignment.delete(lower);
  }
}
