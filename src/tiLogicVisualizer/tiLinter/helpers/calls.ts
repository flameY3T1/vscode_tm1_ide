import { TiFunctionCall, TiStatement } from '../../types';
import { isStringLiteral } from './expressions';

/**
 * Collect all function-call statements in source order (depth-first into
 * IF-/WHILE-bodies). Used by the post-traversal pairing rules
 * (`cube-logging-not-restored`, `temp-object-not-destroyed`).
 */
export function collectFunctionCalls(statements: TiStatement[], out: TiFunctionCall[] = []): TiFunctionCall[] {
  for (const stmt of statements) {
    switch (stmt.type) {
      case 'functionCall':
        out.push(stmt);
        break;
      case 'if':
        collectFunctionCalls(stmt.thenBody, out);
        for (const clause of stmt.elseIfClauses) { collectFunctionCalls(clause.body, out); }
        collectFunctionCalls(stmt.elseBody, out);
        break;
      case 'while':
        collectFunctionCalls(stmt.body, out);
        break;
      default: // other statements neither nest nor matter here
        break;
    }
  }
  return out;
}

/** Inner text of a TI string literal (`'It''s'` → `It's`). Caller must check isStringLiteral first. */
export function stringLiteralInner(token: string): string {
  return token.trim().slice(1, -1).replace(/''/g, "'");
}

/**
 * Token match for argument pairing: two string literals match on their inner
 * text (case-insensitive); two non-literal tokens (variables/expressions)
 * match on identical trimmed text (case-insensitive). Literal vs. variable
 * never matches (cannot be statically proven).
 */
export function tiTokensMatch(a: string, b: string): boolean {
  const ta = a.trim();
  const tb = b.trim();
  const litA = isStringLiteral(ta);
  const litB = isStringLiteral(tb);
  if (litA !== litB) { return false; }
  if (litA) { return stringLiteralInner(ta).toLowerCase() === stringLiteralInner(tb).toLowerCase(); }
  return ta.toLowerCase() === tb.toLowerCase();
}
