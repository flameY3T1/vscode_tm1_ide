/**
 * Per-instance lint-rule configuration. Pure, vscode-free.
 *
 * The filter NEVER forces a default severity — it only applies a severity the
 * user explicitly overrode. This keeps existing behavior byte-identical under
 * the default config (rules like 'wrong-section' that emit at multiple
 * severities are preserved). The `severity` field in LINT_RULE_DEFAULTS is the
 * nominal value shown in the config UI's severity dropdown.
 */
import type { LintDiagnose, LintRuleId, LintSeverity, TiSection } from '../lintTypes';

export interface LintRuleSetting { enabled: boolean; severity?: LintSeverity }
export interface LintRuleConfig {
  rules: Partial<Record<LintRuleId, LintRuleSetting>>;
  /** Per-section enable for the unused-variable rule. Missing → UNUSED_VAR_SECTION_DEFAULTS. */
  unusedVariableSections?: Partial<Record<TiSection, boolean>>;
  /** Configurable naming-rule prefixes. Missing → NAMING_PREFIX_DEFAULTS. */
  namingPrefixes?: { numeric?: string; string?: string; param?: string; datasource?: string };
}

/** unused-variable is on by default only in metadata+data (record loop sections). */
export const UNUSED_VAR_SECTION_DEFAULTS: Record<TiSection, boolean> = {
  prolog: false, metadata: true, data: true, epilog: false,
};

/** Default prefix letters for the variable/parameter/datasource naming rules. */
export const NAMING_PREFIX_DEFAULTS = { numeric: 'n', string: 's', param: 'p', datasource: 'v' } as const;

interface RuleDefault { enabled: boolean; severity: LintSeverity }

export const LINT_RULE_DEFAULTS: Record<LintRuleId, RuleDefault> = {
  'endless-loop':              { enabled: true, severity: 'warning' },
  'wrong-arg-count':           { enabled: true, severity: 'error' },
  'string-compare-without-at': { enabled: true, severity: 'warning' },
  'numeric-compare-with-at':   { enabled: true, severity: 'warning' },
  'type-mismatch-assignment':  { enabled: true, severity: 'error' },
  'wrong-param-type':          { enabled: true, severity: 'error' },
  'unused-variable':           { enabled: true, severity: 'warning' },
  'dead-store':                { enabled: false, severity: 'hint' },
  'empty-if':                  { enabled: true, severity: 'warning' },
  'empty-while':               { enabled: true, severity: 'warning' },
  'cellput-no-error-handling': { enabled: true, severity: 'warning' },
  'unknown-function':          { enabled: true, severity: 'hint' },
  'missing-semicolon':         { enabled: true, severity: 'error' },
  'wrong-section':             { enabled: true, severity: 'error' },
  'undefined-variable':        { enabled: true, severity: 'warning' },
  'v12-deprecated':            { enabled: true, severity: 'info' },
  'v12-only':                  { enabled: true, severity: 'info' },
  'v12-file-path':             { enabled: true, severity: 'warning' },
  'process-return-code-literal': { enabled: true, severity: 'warning' },
  'ti-unknown-cube':           { enabled: true, severity: 'warning' },
  'ti-unknown-dimension':      { enabled: true, severity: 'warning' },
  'ti-unknown-process':        { enabled: true, severity: 'warning' },
  'ti-wrong-process-params':   { enabled: true, severity: 'warning' },
  'dead-code-condition':       { enabled: true, severity: 'hint' },
  'tm1-error-code':            { enabled: true, severity: 'error' },
  'performance-hint':          { enabled: true, severity: 'hint' },
  'hardcoded-path':            { enabled: true, severity: 'warning' },
  'expand-missing':            { enabled: true, severity: 'warning' },
  'non-ascii-identifier':      { enabled: true, severity: 'warning' },
  'parse-error':               { enabled: true, severity: 'error' },
  'exec-command-forbidden':    { enabled: true, severity: 'warning' },
  'process-call-not-literal':  { enabled: true, severity: 'warning' },
  'processquit-unreachable':   { enabled: true, severity: 'warning' },
  'readonly-param-write':      { enabled: true, severity: 'warning' },
  'odbc-password-not-param':   { enabled: true, severity: 'info' },
  'var-naming-prefix':         { enabled: false, severity: 'info' },
  'param-naming-prefix':       { enabled: false, severity: 'info' },
  'datasource-var-naming':     { enabled: false, severity: 'info' },
  'missing-docstring':         { enabled: false, severity: 'info' },
  'invalid-object-name':       { enabled: false, severity: 'warning' },
  'comment-before-if':         { enabled: false, severity: 'info' },
  'comment-before-while':      { enabled: false, severity: 'info' },
  'cube-logging-not-restored': { enabled: true, severity: 'warning' },
  'temp-object-not-destroyed': { enabled: true, severity: 'hint' },
  'element-write-before-commit': { enabled: true, severity: 'warning' },
  'ascii-output-overwrite':    { enabled: true, severity: 'warning' },
  'executeprocess-return-ignored': { enabled: true, severity: 'hint' },
  'recursive-process-call':    { enabled: true, severity: 'warning' },
  'cellget-in-loop-constant':  { enabled: true, severity: 'hint' },
  'inconsistent-var-casing':   { enabled: true, severity: 'warning' },
  'invalid-arg-value':         { enabled: true, severity: 'warning' },
  // Fires only on a mixture (see hierarchyStylePure.ts) — a process entirely without
  // hierarchy form stays silent, hence on by default.
  'hierarchy-style-mixed':     { enabled: true, severity: 'warning' },
};

/** Filter + re-severity diagnostics per config. Single decision point for all ruleIds.
 *  @param section When provided, applies the per-section gate for `unused-variable`. */
export function applyLintRuleConfig(diags: LintDiagnose[], cfg: LintRuleConfig, section?: TiSection): LintDiagnose[] {
  const out: LintDiagnose[] = [];
  for (const d of diags) {
    const id = d.ruleId as LintRuleId;
    const setting = cfg.rules[id];
    const def = LINT_RULE_DEFAULTS[id];
    const enabled = setting?.enabled ?? def?.enabled ?? true;
    if (!enabled) { continue; }
    // Per-section gate for unused-variable (only when the section is known).
    if (id === 'unused-variable' && section) {
      const secOn = cfg.unusedVariableSections?.[section] ?? UNUSED_VAR_SECTION_DEFAULTS[section];
      if (!secOn) { continue; }
    }
    out.push(setting?.severity ? { ...d, severity: setting.severity } : d);
  }
  return out;
}

/** Effective full per-rule view (defaults overlaid by stored overrides) — for the config UI. */
export function mergeLintConfig(stored: LintRuleConfig | undefined): Record<LintRuleId, RuleDefault> {
  const merged = {} as Record<LintRuleId, RuleDefault>;
  for (const id of Object.keys(LINT_RULE_DEFAULTS) as LintRuleId[]) {
    const ov = stored?.rules[id];
    merged[id] = {
      enabled: ov?.enabled ?? LINT_RULE_DEFAULTS[id].enabled,
      severity: ov?.severity ?? LINT_RULE_DEFAULTS[id].severity,
    };
  }
  return merged;
}
