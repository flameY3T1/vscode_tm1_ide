import { LintDiagnose, TiSection, VariableTypeMap } from '../lintTypes';
import { TiStatement } from '../types';

/**
 * Optional lint modes that control the noise behaviour.
 *
 * `bedrockMode`: true if the file belongs to the IBM Bedrock library
 * (filename `}bedrock.*`). Suppresses `unused-variable` and `dead-store`
 * diagnostics — legacy inheritance that we do not edit anyway.
 */
export interface LintOptions {
  bedrockMode?: boolean;
  /** V12 mode (`tm1.v12Mode`) — enables `v12-file-path`. On 11.x those paths are legal. */
  v12Mode?: boolean;
  /** Declared TI parameter names (any case) — for readonly-param-write, odbc-password, param-naming-prefix. */
  paramNames?: string[];
  /** Declared datasource variable names (any case) — for readonly-param-write, datasource-var-naming. */
  datasourceVars?: string[];
  /** Configurable naming prefixes for the variable/parameter/datasource naming rules (each falls back to its default). */
  namingPrefixes?: { numeric?: string; string?: string; param?: string; datasource?: string };
  /** Name of the process being linted — enables `recursive-process-call`. Missing → rule is silent. */
  processName?: string;
  /**
   * ASTs of all LATER sections (in execution order). Enables the cross-section
   * look-ahead of `cube-logging-not-restored` / `temp-object-not-destroyed`
   * (disable/create in Prolog + restore/destroy in Epilog must NOT fire).
   * Missing → only the current section is searched.
   */
  futureAsts?: TiStatement[][];
  /**
   * ASTs of all EARLIER sections (in execution order). Lets the Metadata see a
   * Prolog's uncommitted dimension changes (`element-write-before-commit`).
   */
  previousAsts?: TiStatement[][];
  /**
   * When true (the default when undefined), TM1 object/element name comparisons
   * ignore internal whitespace — TM1 stores/matches `'Hallo Welt'` as `hallowelt`.
   * Set false to treat whitespace as significant. Used by `temp-object-not-destroyed`
   * (create/destroy pairing) and the server existence linter.
   */
  nameWhitespaceInsensitive?: boolean;
}

/** First-assignment info per variable (lowercase key). */
export interface AssignedInfo {
  line: number;
  originalName: string;
}

/** Shared traversal context passed through visit-functions. */
export interface TraverseContext {
  diagnostics: LintDiagnose[];
  variableTypes: VariableTypeMap;
  allReadVariables: Set<string>;
  lastUnreadAssignment: Map<string, number>;
  assignedVariables: Map<string, AssignedInfo>;
  section?: TiSection;
  options?: LintOptions;
  /** Current IF/WHILE nesting depth (0 = unconditional top level). */
  conditionalDepth: number;
  /** Current WHILE nesting depth (0 = not inside any loop) — for cellget-in-loop-constant. */
  whileDepth: number;
  /** conditionalDepth at which each variable's last assignment occurred (lowercase key). */
  assignmentDepth: Map<string, number>;
  /** Raw source split into lines (for comment-before-if/while). Undefined → those rules are skipped. */
  sourceLines?: string[];
  /** Blocks that already emitted 'cellput-no-error-handling' (anti-spam: one per block). Lazily created. */
  cellPutWarnedBlocks?: Set<TiStatement[]>;
  /** Lines that already emitted 'cellget-in-loop-constant' (max 1 per line). Lazily created. */
  cellGetConstWarnedLines?: Set<number>;
}

/** One undefined variable found during pre-deploy check. */
export interface UndefinedVariable {
  /** Original (non-lowercased) name as it appears in code, if found. */
  name: string;
  /** Section the first (AST-real, non-comment/-string) read occurs in. */
  section: TiSection;
  /** 0-based line WITHIN the section of that first real read. Same base as
   *  InconsistentCasing so the provider adds the chunk offset identically. */
  line: number;
}
