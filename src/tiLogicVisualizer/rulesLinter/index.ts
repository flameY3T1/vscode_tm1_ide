/**
 * Rules linter package API. Callers outside this directory take these names from here, not
 * from the sub-module that defines them.
 *
 * Module responsibilities:
 * - rulesLinter/types.ts      — RulesLintDiagnose, ApiRequestFn, DbCall, BracketDimRef
 * - rulesLinter/helpers.ts    — neutralizeLine + line-level helpers
 * - rulesLinter/brackets.ts   — extractBracketRefs, validateBracketRefSyntax, parseBracketDimRefs
 * - rulesLinter/dbCalls.ts    — extractDbCalls + splitArgs
 * - rulesLinter/lintSync.ts   — lintRules (synchronous, parser-driven)
 * - rulesLinter/lintServer.ts — lintRulesServer (async, REST cube/dim checks)
 */

export type { RulesLintDiagnose, ApiRequestFn } from './types';
export { extractBracketRefs, validateBracketRefSyntax, parseBracketDimRefs } from './brackets';
export { extractDbCalls } from './dbCalls';
export { lintRules } from './lintSync';
export { lintRulesServer } from './lintServer';
