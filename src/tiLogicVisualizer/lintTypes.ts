/** Schweregrad einer Lint-Diagnose */
export type LintSeverity = 'error' | 'warning' | 'hint' | 'info';

/** TM1 Prozessabschnitt */
export type TiSection = 'prolog' | 'metadata' | 'data' | 'epilog';

/** Alle bekannten Regel-IDs des TI-Linters */
export type LintRuleId =
  | 'endless-loop'
  | 'wrong-arg-count'
  | 'string-compare-without-at'
  | 'numeric-compare-with-at'
  | 'type-mismatch-assignment'
  | 'wrong-param-type'
  | 'unused-variable'
  | 'dead-store'
  | 'empty-if'
  | 'empty-while'
  | 'cellput-no-error-handling'
  | 'unknown-function'
  | 'missing-semicolon'
  | 'wrong-section'
  | 'undefined-variable'
  | 'v12-deprecated'
  | 'v12-only'
  | 'v12-file-path'
  | 'process-return-code-literal'
  | 'ti-unknown-cube'
  | 'ti-unknown-dimension'
  | 'ti-unknown-process'
  | 'ti-wrong-process-params'
  | 'dead-code-condition'
  | 'tm1-error-code'
  | 'performance-hint'
  | 'hardcoded-path'
  | 'expand-missing'
  | 'non-ascii-identifier'
  | 'parse-error'
  | 'exec-command-forbidden'
  | 'process-call-not-literal'
  | 'processquit-unreachable'
  | 'readonly-param-write'
  | 'odbc-password-not-param'
  | 'var-naming-prefix'
  | 'param-naming-prefix'
  | 'datasource-var-naming'
  | 'missing-docstring'
  | 'invalid-object-name'
  | 'comment-before-if'
  | 'comment-before-while'
  | 'cube-logging-not-restored'
  | 'temp-object-not-destroyed'
  | 'element-write-before-commit'
  | 'ascii-output-overwrite'
  | 'executeprocess-return-ignored'
  | 'recursive-process-call'
  | 'cellget-in-loop-constant'
  | 'inconsistent-var-casing'
  | 'hierarchy-style-mixed'
  | 'invalid-arg-value';

/** A single lint diagnostic */
export interface LintDiagnose {
  /** 1-basierte Zeilennummer */
  line: number;
  /** Schweregrad */
  severity: LintSeverity;
  /** Regel-ID */
  ruleId: LintRuleId;
  /**
   * Localized, rendered display message (`[rule-id] text`). Populated at the
   * extension-side display boundary via `localizeLintDiagnostics`; pure rules
   * leave it undefined and set `messageKey`/`messageArgs` instead.
   */
  message?: string;
  /** English l10n key (message template with {0} placeholders, no rule-id prefix). */
  messageKey?: string;
  /** Positional arguments for the {N} placeholders in `messageKey`. */
  messageArgs?: (string | number)[];
}

/** Datentyp einer TI-Variable */
export type VariableType = 'string' | 'numeric';

/** Information about an inferred variable */
export interface VariableInfo {
  type: VariableType;
  /** Line of the first assignment */
  firstAssignmentLine: number;
}

/** Key: Variablenname in Lowercase */
export type VariableTypeMap = Map<string, VariableInfo>;
