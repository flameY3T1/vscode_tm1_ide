import { TiAst } from '../types';
import { LintDiagnose, TiSection, VariableTypeMap } from '../lintTypes';
import { AssignedInfo, LintOptions, TraverseContext } from './types';
import { collectAllReads } from './helpers/reads';
import { traverseStatements } from './traverse';
import { checkUnusedVariables } from './rules/check-unused-variable';
import { checkHardcodedPaths } from './rules/check-hardcoded-path';
import { checkV12FilePaths } from './rules/check-v12-file-path';
import { checkProcessReturnLiterals } from './rules/check-process-return-literal';
import { checkExpandMissing } from './rules/check-expand-missing';
import { checkNonAsciiIdentifiers } from './rules/check-non-ascii-identifier';
import { checkDeclarationNaming } from './rules/check-naming';
import { checkCubeLogging } from './rules/check-cube-logging';
import { checkTempObjects } from './rules/check-temp-objects';
import { checkElementWriteBeforeCommit } from './rules/check-element-write-before-commit';
import { checkAsciiOutputOverwrite } from './rules/check-ascii-output-overwrite';

// Re-export public surface for downstream consumers (tests, providers, deploy, …)
export { collectAllReads, collectReadsWithLines, collectAssignedVariables } from './helpers/reads';
export { findUndefinedVariables } from './undefinedVariables';
export { findInconsistentCasing } from './inconsistentCasing';
export type { LintOptions } from './types';

/**
 * Analyses a TI AST and returns all lint diagnostics found.
 * Pure function without a vscode dependency.
 *
 * @param ast The AST to analyse
 * @param knownVariables Optional VariableTypeMap with already known variables
 *   from earlier sections (e.g. prolog variables for metadata).
 * @param rawCode Optional raw code for line-based checks
 * @param futureReads Optional set of variable names (lowercase) that are read in later
 *   sections — these do not count as "unused".
 */
export function lintTiAst(
  ast: TiAst,
  knownVariables?: VariableTypeMap,
  rawCode?: string,
  futureReads?: Set<string>,
  section?: TiSection,
  options?: LintOptions,
): LintDiagnose[] {
  return runLint(ast, knownVariables, rawCode, futureReads, section, options).diagnostics;
}

/**
 * Like lintTiAst, but additionally returns the VariableTypeMap
 * so that it can be passed on to the next section.
 */
export function lintTiAstWithContext(
  ast: TiAst,
  knownVariables?: VariableTypeMap,
  rawCode?: string,
  futureReads?: Set<string>,
  section?: TiSection,
  options?: LintOptions,
): { diagnostics: LintDiagnose[]; variableTypes: VariableTypeMap } {
  return runLint(ast, knownVariables, rawCode, futureReads, section, options);
}

function runLint(
  ast: TiAst,
  knownVariables: VariableTypeMap | undefined,
  rawCode: string | undefined,
  futureReads: Set<string> | undefined,
  section: TiSection | undefined,
  options: LintOptions | undefined,
): { diagnostics: LintDiagnose[]; variableTypes: VariableTypeMap } {
  const diagnostics: LintDiagnose[] = [];
  const variableTypes: VariableTypeMap = new Map(knownVariables ?? []);

  if (ast.length === 0) {
    return { diagnostics, variableTypes };
  }

  const inheritedVariables = new Set(knownVariables?.keys() ?? []);
  const allReadVariables = collectAllReads(ast);
  const lastUnreadAssignment = new Map<string, number>();
  const assignedVariables = new Map<string, AssignedInfo>();

  const ctx: TraverseContext = {
    diagnostics,
    variableTypes,
    allReadVariables,
    lastUnreadAssignment,
    assignedVariables,
    section,
    options,
    conditionalDepth: 0,
    whileDepth: 0,
    assignmentDepth: new Map(),
    sourceLines: rawCode !== undefined ? rawCode.split('\n') : undefined,
  };

  traverseStatements(ast, ctx);

  // Post-traversal rules
  checkUnusedVariables(assignedVariables, allReadVariables, inheritedVariables, futureReads, options, diagnostics);
  checkHardcodedPaths(rawCode, diagnostics);
  checkV12FilePaths(rawCode, options, diagnostics);
  checkProcessReturnLiterals(rawCode, diagnostics);
  // Declared variables for expand-missing: locals (typed + untyped assignments,
  // incl. inherited prior-section vars via knownVariables) + params + datasource vars.
  const declaredForExpand = new Set<string>(variableTypes.keys());
  for (const key of assignedVariables.keys()) { declaredForExpand.add(key); }
  for (const p of options?.paramNames ?? []) { declaredForExpand.add(p.toLowerCase()); }
  for (const v of options?.datasourceVars ?? []) { declaredForExpand.add(v.toLowerCase()); }
  checkExpandMissing(rawCode, declaredForExpand, diagnostics);
  checkNonAsciiIdentifiers(assignedVariables, diagnostics);
  checkDeclarationNaming(section, rawCode, options, diagnostics);
  // Pairing rules with cross-section look-ahead via options.futureAsts
  // (disable/create here + restore/destroy in a later section must not fire).
  checkCubeLogging(ast, options, diagnostics);
  checkTempObjects(ast, options, diagnostics);
  checkElementWriteBeforeCommit(ast, section, options, diagnostics);
  checkAsciiOutputOverwrite(ast, options, diagnostics);

  return { diagnostics, variableTypes };
}
