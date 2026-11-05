import { TiFunctionCall, TiStatement } from '../../types';
import { TraverseContext } from '../types';
import { isGuardCondition, ifBodyHasEarlyExit } from '../helpers/conditions';

/** Cell-write functions that should be guarded (lowercase). */
const CELL_WRITE_FUNCS = new Set(['cellputn', 'cellputs', 'cellincrementn']);

/**
 * Rule 'cellput-no-error-handling' — CellPutN/CellPutS/CellIncrementN without
 * a recognizable guard:
 *
 * - Guard 1a: the call sits inside an IF whose condition is a guard condition
 *   (`CellIsUpdateable`, `DIMIX`, `*ElementExists` — see `isGuardCondition`).
 *   `enclosingCondition` is threaded through traverse from visit-if-block.
 * - Guard 1b: a PRECEDING statement in the same block is an IF that guards —
 *   either via guard condition or via early-exit body (ItemSkip/ItemReject/…).
 * - Guard 2: a FOLLOWING statement in the same block is an IF whose condition
 *   references `ProcessError`.
 *
 * Anti-spam: at most ONE diagnostic per block (first unguarded cell write),
 * deduped via `ctx.cellPutWarnedBlocks` keyed on the block-statements array.
 */
export function checkCellPutGuard(
  stmt: TiFunctionCall,
  indexInBlock: number,
  blockStatements: TiStatement[],
  ctx: TraverseContext,
  enclosingCondition?: string,
): void {
  if (!CELL_WRITE_FUNCS.has(stmt.name.toLowerCase())) { return; }

  // Guard 1a: enclosing IF condition is a guard (CellIsUpdateable etc.)
  if (enclosingCondition && isGuardCondition(enclosingCondition)) { return; }

  // Guard 1b: a preceding IF in the same block acts as guard
  for (let j = 0; j < indexInBlock; j++) {
    const s = blockStatements[j];
    if (s.type === 'if' && (isGuardCondition(s.condition) || ifBodyHasEarlyExit(s))) {
      return;
    }
  }

  // Guard 2: a following IF in the same block checks ProcessError
  for (let j = indexInBlock + 1; j < blockStatements.length; j++) {
    const s = blockStatements[j];
    if (s.type === 'if' && /\bprocesserror\b/i.test(s.condition)) {
      return;
    }
  }

  // Anti-spam: only the first unguarded cell write per block
  if (!ctx.cellPutWarnedBlocks) { ctx.cellPutWarnedBlocks = new Set(); }
  if (ctx.cellPutWarnedBlocks.has(blockStatements)) { return; }
  ctx.cellPutWarnedBlocks.add(blockStatements);

  ctx.diagnostics.push({
    line: stmt.line,
    severity: 'warning',
    ruleId: 'cellput-no-error-handling',
    messageKey: `'{0}' without error handling — guard it with IF(CellIsUpdateable(...)=1, ...) or check ProcessError afterwards.`,
    messageArgs: [stmt.name],
  });
}
