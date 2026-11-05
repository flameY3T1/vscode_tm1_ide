import { TiAssignment } from '../../types';
import { LintDiagnose, TiSection } from '../../lintTypes';
import { LintOptions, TraverseContext } from '../types';
import { inferExpressionType } from '../helpers/expressions';

/**
 * var-naming-prefix — local variable prefix convention: numeric→'n', string→'s'.
 * Fires at the first assignment only; skips params/datasource vars and
 * already-correctly-prefixed names.
 */
export function checkVarNaming(stmt: TiAssignment, ctx: TraverseContext): void {
  const varLower = stmt.variable.toLowerCase();

  // Only the first assignment of a variable.
  if (ctx.assignedVariables.has(varLower)) { return; }

  // Skip declared params / datasource vars (they have p/v conventions).
  const params = ctx.options?.paramNames ?? [];
  const dsv = ctx.options?.datasourceVars ?? [];
  if (params.some(p => p.toLowerCase() === varLower) || dsv.some(v => v.toLowerCase() === varLower)) {
    return;
  }

  const type = inferExpressionType(stmt.expression, ctx.variableTypes);
  let prefix: string | undefined;
  if (type === 'numeric') { prefix = ctx.options?.namingPrefixes?.numeric ?? 'n'; }
  else if (type === 'string') { prefix = ctx.options?.namingPrefixes?.string ?? 's'; }
  if (prefix === undefined || prefix === '') { return; }
  if (stmt.variable.toLowerCase().startsWith(prefix.toLowerCase())) { return; }

  ctx.diagnostics.push({
    line: stmt.line,
    severity: 'info',
    ruleId: 'var-naming-prefix',
    messageKey: `{0} variable '{1}' should start with '{2}'.`,
    messageArgs: [type === 'numeric' ? 'Numeric' : 'String', stmt.variable, prefix],
  });
}

/**
 * Declaration-level naming (parameters, datasource vars) + docstring. Runs once per
 * section after AST traversal; only acts on the prolog.
 */
export function checkDeclarationNaming(
  section: TiSection | undefined,
  rawCode: string | undefined,
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  if (section !== 'prolog') { return; }

  // param-naming-prefix — parameters should start with the configured prefix (default 'p').
  const paramPrefix = options?.namingPrefixes?.param ?? 'p';
  if (paramPrefix !== '') {
    for (const p of options?.paramNames ?? []) {
      if (!p.toLowerCase().startsWith(paramPrefix.toLowerCase())) {
        diagnostics.push({
          line: 1, severity: 'info', ruleId: 'param-naming-prefix',
          messageKey: `Parameter '{0}' should start with '{1}'.`,
          messageArgs: [p, paramPrefix],
        });
      }
    }
  }
  // datasource-var-naming — datasource variables should start with the configured prefix (default 'v').
  const dsPrefix = options?.namingPrefixes?.datasource ?? 'v';
  if (dsPrefix !== '') {
    for (const v of options?.datasourceVars ?? []) {
      if (!v.toLowerCase().startsWith(dsPrefix.toLowerCase())) {
        diagnostics.push({
          line: 1, severity: 'info', ruleId: 'datasource-var-naming',
          messageKey: `Datasource variable '{0}' should start with '{1}'.`,
          messageArgs: [v, dsPrefix],
        });
      }
    }
  }
  // missing-docstring — prolog should open with a docstring (a leading '#'-comment line).
  const firstCode = (rawCode ?? '').split('\n').map(l => l.trim()).find(l => l.length > 0);
  if (firstCode !== undefined && !firstCode.startsWith('#')) {
    diagnostics.push({
      line: 1, severity: 'info', ruleId: 'missing-docstring',
      messageKey: `Prolog should start with a comment block (docstring).`,
    });
  }
}
