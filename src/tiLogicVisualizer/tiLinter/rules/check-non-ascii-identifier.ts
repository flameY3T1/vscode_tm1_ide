import { LintDiagnose } from '../../lintTypes';
import { NON_ASCII_ID_RE } from '../constants';
import { AssignedInfo } from '../types';

/**
 * Post-traversal check: emit `non-ascii-identifier` for any assigned variable
 * name that contains umlauts or ß.
 */
export function checkNonAsciiIdentifiers(
  assignedVariables: Map<string, AssignedInfo>,
  diagnostics: LintDiagnose[],
): void {
  for (const [, info] of assignedVariables) {
    if (NON_ASCII_ID_RE.test(info.originalName)) {
      diagnostics.push({
        line: info.line,
        severity: 'hint',
        ruleId: 'non-ascii-identifier',
        messageKey: `Variable '{0}' contains umlauts or ß — please avoid using them.`,
        messageArgs: [info.originalName],
      });
    }
  }
}
