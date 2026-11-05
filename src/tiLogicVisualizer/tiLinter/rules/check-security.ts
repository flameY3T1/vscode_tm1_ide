import { TiFunctionCall, TiStatement, TiAssignment } from '../../types';
import { TraverseContext } from '../types';
import { isStringLiteral } from '../helpers/expressions';

/**
 * Security/semantic checks on function-call statements (linter S-group).
 * Called from visitFunctionCall. Pushes into ctx.diagnostics; the host
 * filter decides final visibility/severity.
 */
export function checkSecurityCall(
  stmt: TiFunctionCall,
  _indexInBlock: number,
  _blockStatements: TiStatement[],
  ctx: TraverseContext,
): void {
  const name = stmt.name.toLowerCase();

  // exec-command-forbidden — ExecuteCommand is disabled for security on most TM1 servers.
  if (name === 'executecommand') {
    ctx.diagnostics.push({
      line: stmt.line,
      severity: 'warning',
      ruleId: 'exec-command-forbidden',
      messageKey: 'ExecuteCommand should be avoided for security reasons.',
    });
  }

  // process-call-not-literal — RunProcess/ExecuteProcess should take a string-literal process name
  // (a variable name can't be statically validated and often hides typos).
  if (name === 'runprocess' || name === 'executeprocess') {
    const first = stmt.args[0]?.trim();
    if (first !== undefined && !isStringLiteral(first)) {
      ctx.diagnostics.push({
        line: stmt.line,
        severity: 'warning',
        ruleId: 'process-call-not-literal',
        messageKey: `'{0}' should use a string-literal process name.`,
        messageArgs: [stmt.name],
      });
    }
  }

  // (ItemSkip/ItemReject section validity is handled generally by the
  // `wrong-section` rule via RECORD_LOOP_ONLY in visit-function-call.)

  // odbc-password-not-param — ODBCOpen password (3rd arg) should be a declared TI parameter,
  // never a hardcoded literal in the source.
  if (name === 'odbcopen') {
    const params = ctx.options?.paramNames;
    const pwd = stmt.args[2]?.trim();
    if (params && pwd !== undefined) {
      const lit = isStringLiteral(pwd);
      const isParam = params.some(p => p.toLowerCase() === pwd.toLowerCase());
      if (lit || !isParam) {
        ctx.diagnostics.push({
          line: stmt.line,
          severity: 'info',
          ruleId: 'odbc-password-not-param',
          messageKey: 'ODBCOpen password should be a defined TI parameter, not a literal.',
        });
      }
    }
  }

  // readonly-param-write: handled in checkReadonlyWrite (called from visitAssignment).

  // processquit-unreachable — ProcessQuit should be the last executable statement in its block;
  // anything after it is unreachable.
  if (name === 'processquit') {
    let hasLater = false;
    for (let j = _indexInBlock + 1; j < _blockStatements.length; j++) {
      const s = _blockStatements[j] as { type?: string };
      if (s && s.type !== 'comment') { hasLater = true; break; }
    }
    if (hasLater) {
      ctx.diagnostics.push({
        line: stmt.line,
        severity: 'warning',
        ruleId: 'processquit-unreachable',
        messageKey: 'Code after ProcessQuit is unreachable.',
      });
    }
  }
}

/** readonly-param-write — assignment to a parameter or datasource variable (should be read-only). */
export function checkReadonlyWrite(stmt: TiAssignment, ctx: TraverseContext): void {
  const lhs = stmt.variable.toLowerCase();
  const params = ctx.options?.paramNames ?? [];
  const dsv = ctx.options?.datasourceVars ?? [];
  const isReadonly =
    params.some(p => p.toLowerCase() === lhs) || dsv.some(v => v.toLowerCase() === lhs);
  if (isReadonly) {
    ctx.diagnostics.push({
      line: stmt.line,
      severity: 'warning',
      ruleId: 'readonly-param-write',
      messageKey: `'{0}' is a parameter/datasource field and should not be overwritten.`,
      messageArgs: [stmt.variable],
    });
  }
}
