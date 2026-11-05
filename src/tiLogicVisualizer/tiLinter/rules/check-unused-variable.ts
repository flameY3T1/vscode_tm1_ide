import { LintDiagnose } from '../../lintTypes';
import { TI_SYSTEM_VARIABLES } from '../../tiSystemVars';
import { AssignedInfo, LintOptions } from '../types';

/**
 * Post-traversal check: emit `unused-variable` for variables that are assigned
 * but never read (in this section, in future sections, or as a system var).
 * Suppressed entirely in bedrock mode.
 */
export function checkUnusedVariables(
  assignedVariables: Map<string, AssignedInfo>,
  allReadVariables: Set<string>,
  inheritedVariables: Set<string>,
  futureReads: Set<string> | undefined,
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  if (options?.bedrockMode) { return; }
  for (const [varLower, info] of assignedVariables) {
    if (inheritedVariables.has(varLower)) { continue; }
    if (allReadVariables.has(varLower)) { continue; }
    if (futureReads?.has(varLower)) { continue; }
    if (TI_SYSTEM_VARIABLES.has(varLower)) { continue; }
    diagnostics.push({
      line: info.line,
      severity: 'hint',
      ruleId: 'unused-variable',
      messageKey: `Variable '{0}' is assigned but never used.`,
      messageArgs: [info.originalName],
    });
  }
}
