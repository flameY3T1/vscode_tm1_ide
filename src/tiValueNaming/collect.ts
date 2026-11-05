import type { ConsistencyProcess } from '../tiConsistency/types';
import type { Assignment } from './types';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import type { TiStatement } from '../tiLogicVisualizer/types';
import { buildProcessEnv, resolveExpression } from '../references/variableEnv';
import { isReservedName } from '../tiConsistency/reserved';
import { combinedLineToUnit } from '../tiConsistency/unitLines';

/** Collects every string-literal assignment in a process, walking control-flow bodies. */
export function collectStringAssignments(proc: ConsistencyProcess): Assignment[] {
  const combined = proc.units.map(u => u.text).join('\n');
  const parsed = parseTiCode(combined);
  if (!parsed.ok) { return []; }
  const env = buildProcessEnv(combined, proc.params.map(p => p.name));
  const out: Assignment[] = [];
  const visit = (stmts: TiStatement[]): void => {
    for (const s of stmts) {
      if (s.type === 'assignment') {
        if (isReservedName(s.variable.toLowerCase())) { continue; }
        if (s.expression.trim().startsWith("'")) { // string-literal-ish RHS
          const b = resolveExpression(s.expression, env);
          // Skip empty-string initializers (`x = '';`) — a common init pattern, not a
          // meaningful value→name mapping; would group every initialized var together.
          if (b.kind === 'literal' && b.value !== '') {
            const { unit, line } = combinedLineToUnit(proc.units, s.line);
            out.push({ process: proc.name, varName: s.variable, varLc: s.variable.toLowerCase(), value: b.value, unit, line });
          }
        }
      } else if (s.type === 'if') {
        visit(s.thenBody);
        for (const c of s.elseIfClauses) { visit(c.body); }
        visit(s.elseBody);
      } else if (s.type === 'while') {
        visit(s.body);
      }
    }
  };
  visit(parsed.ast);
  return out;
}
