import type { Analysis, Def, ReadOcc, Pos } from './types';
import type { TiStatement } from '../tiLogicVisualizer/types';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { occurrencesOf } from '../tiConsistency/scanText';
import { buildProcessEnv, resolveExpression } from '../references/variableEnv';

export function analyzeVariable(combined: string, paramNames: string[], varLc: string): Analysis | null {
  const parsed = parseTiCode(combined);
  if (!parsed.ok) { return null; }
  const env = buildProcessEnv(combined, paramNames);

  const defsRaw: { line: number; expression: string }[] = [];
  const walk = (stmts: TiStatement[]): void => {
    for (const s of stmts) {
      if (s.type === 'assignment') {
        if (s.variable.toLowerCase() === varLc) { defsRaw.push({ line: s.line, expression: s.expression }); }
      } else if (s.type === 'if') {
        walk(s.thenBody); for (const c of s.elseIfClauses) { walk(c.body); } walk(s.elseBody);
      } else if (s.type === 'while') { walk(s.body); }
    }
  };
  walk(parsed.ast);
  defsRaw.sort((a, b) => a.line - b.line);

  const occ = occurrencesOf(combined, varLc);
  const realLines = combined.split('\n');
  const lhsKeys = new Set<string>();
  const defs: Def[] = defsRaw.map((d, id) => {
    const onLine = occ.filter(o => o.line === d.line).sort((a, b) => a.column - b.column);
    let lhs: Pos = { line: d.line, column: onLine[0]?.column ?? 1 };
    for (const o of onLine) {
      const after = realLines[d.line - 1].slice(o.column - 1 + o.length).replace(/^\s*/, '');
      if (after.startsWith('=') && !after.startsWith('==')) { lhs = { line: o.line, column: o.column }; break; }
    }
    lhsKeys.add(`${lhs.line}:${lhs.column}`);
    const binding = resolveExpression(d.expression, env);
    const isLiteralString = binding.kind === 'literal' && d.expression.trim().startsWith("'");
    return { id, line: d.line, lhs, binding, isLiteralString, value: isLiteralString ? binding.value : undefined };
  });

  const reads: ReadOcc[] = occ
    .filter(o => !lhsKeys.has(`${o.line}:${o.column}`))
    .map(o => ({ occ: { line: o.line, column: o.column }, line: o.line }));

  return { defs, reads, ast: parsed.ast };
}
