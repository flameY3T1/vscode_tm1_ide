import { TiFunctionCall } from '../../types';
import { TraverseContext } from '../types';
import { OBJECT_NAME_ARGS, INVALID_OBJECT_NAME_CHARS } from '../constants';
import { isStringLiteral } from '../helpers/expressions';

/**
 * Rule 'invalid-object-name': an object-name literal passed to a TM1 function
 * (Dim/Cube/Subset/... create) must not contain a TM1-illegal character.
 */
export function checkObjectName(
  stmt: TiFunctionCall,
  ctx: TraverseContext,
): void {
  const nameArgs = OBJECT_NAME_ARGS[stmt.name.toLowerCase()];
  if (!nameArgs) { return; }
  for (const idx of nameArgs) {
    const raw = stmt.args[idx]?.trim();
    if (raw && isStringLiteral(raw)) {
      const inner = raw.slice(1, -1);
      const m = inner.match(INVALID_OBJECT_NAME_CHARS);
      if (m) {
        ctx.diagnostics.push({
          line: stmt.line,
          severity: 'warning',
          ruleId: 'invalid-object-name',
          messageKey: `Object name '{0}' contains the character '{1}' which is not allowed in TM1 (forbidden: ) | ~ ; @ \\ / : * ? " < > !).`,
          messageArgs: [inner, m[0]],
        });
      }
    }
  }
}
