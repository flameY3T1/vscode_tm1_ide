import { TiStatement } from '../types';
import { TraverseContext } from './types';
import { visitAssignment } from './rules/visit-assignment';
import { visitFunctionCall } from './rules/visit-function-call';
import { visitIfBlock } from './rules/visit-if-block';
import { visitWhileBlock } from './rules/visit-while-block';

/**
 * Recursively traverse an array of statements (depth-first).
 * Dispatches to the per-statement visit-fns which run all lint rules
 * and mutate `ctx`.
 */
export function traverseStatements(
  statements: TiStatement[],
  ctx: TraverseContext,
  enclosingCondition?: string,
): void {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    switch (stmt.type) {
      case 'assignment':
        visitAssignment(stmt, ctx);
        break;
      case 'functionCall':
        visitFunctionCall(stmt, i, statements, ctx, enclosingCondition);
        break;
      case 'if':
        visitIfBlock(stmt, ctx, traverseStatements);
        break;
      case 'while':
        visitWhileBlock(stmt, ctx, traverseStatements);
        break;
    }
  }
}
