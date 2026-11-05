/**
 * Shared types for the rules linter modules.
 *
 * Extracted from `rulesLinter.ts` in Post-H17 #6 split.
 */

export {};

export interface RulesLintDiagnose {
  line: number;   // 0-based
  /** Localized display message; populated at the boundary via localizeLintDiagnostics. */
  message?: string;
  /** English l10n key (template with {0} placeholders, no [rule-id] prefix). */
  messageKey?: string;
  /** Positional args for the {N} placeholders in messageKey. */
  messageArgs?: (string | number)[];
  severity: 'error' | 'warning' | 'hint' | 'info';
  ruleId: string;
}

export type ApiRequestFn = (
  method: string,
  path: string,
) => Promise<{ statusCode: number; body: string }>;

export interface DbCall {
  args: string[];
  cubeName: string | null;
}

export interface BracketDimRef {
  dim: string;
  /** Optional hierarchy from 'Dim':'Hier':'Elem' — undefined for 'Dim':'Elem'. */
  hier?: string;
  elems: string[];
}
