/**
 * Per-instance rule configuration for the RULES linter. Pure, vscode-free.
 *
 * Deliberately a sibling of `tiLinter/ruleConfig.ts` rather than a shared module:
 * the two linters have disjoint rule sets (TI statements vs. rules/feeders syntax)
 * and their ids must not collide in one store. The shape, the filter semantics and
 * the merge helper are identical on purpose, so the two config panels can stay
 * analogous — see `commands/rule/rulesLintConfigStore.ts` for the storage side.
 *
 * Like the TI filter, this one NEVER forces a default severity. It only applies a
 * severity the user explicitly overrode, so behaviour under the default config is
 * byte-identical to no filter at all. The `severity` in RULES_LINT_DEFAULTS is the
 * nominal value the config UI shows in its dropdown.
 */
import type { RulesLintDiagnose } from './types';

export type RulesLintSeverity = 'error' | 'warning' | 'hint' | 'info';

/**
 * Every ruleId the rules linter emits. Keeping this a union (rather than the bare
 * `string` the diagnostics carry) is what makes a forgotten entry a compile error
 * in RULES_LINT_DEFAULTS below — the table and the emitters cannot drift apart.
 */
export type RulesLintRuleId =
  | 'db-arg-count-mismatch'
  | 'db-conditional-cube-arg'
  | 'db-element-not-found'
  | 'db-invalid-cube-arg'
  | 'db-too-few-args'
  | 'db-unknown-cube'
  | 'dimension-not-found'
  | 'element-not-found'
  | 'feeder-db-on-lhs'
  | 'feeder-missing-arrow'
  | 'feeder-missing-comma'
  | 'feeder-multi-lhs'
  | 'hierarchy-not-found'
  | 'invalid-cell-ref-syntax'
  | 'missing-semicolon'
  | 'multiple-feeders'
  | 'no-feeders-section'
  | 'parse-error'
  | 'rule-after-feeders'
  | 'unclosed-bracket'
  | 'unqualified-cell-ref';

export interface RulesLintRuleSetting { enabled: boolean; severity?: RulesLintSeverity }
export interface RulesLintConfig {
  rules: Partial<Record<RulesLintRuleId, RulesLintRuleSetting>>;
}

interface RuleDefault { enabled: boolean; severity: RulesLintSeverity }

/**
 * Defaults mirror the severities the emitters use today, so switching the filter on
 * changes nothing until the user touches a rule.
 *
 * `unqualified-cell-ref` is the one rule that is off by default: ['Umsatz'] without
 * its dimension is valid TM1 and by far the most common form, so flagging it on every
 * line is noise for most models. Users who want the discipline turn it on.
 */
export const RULES_LINT_DEFAULTS: Record<RulesLintRuleId, RuleDefault> = {
  'db-arg-count-mismatch':   { enabled: true,  severity: 'error' },
  'db-conditional-cube-arg': { enabled: true,  severity: 'hint' },
  'db-element-not-found':    { enabled: true,  severity: 'warning' },
  'db-invalid-cube-arg':     { enabled: true,  severity: 'error' },
  'db-too-few-args':         { enabled: true,  severity: 'error' },
  'db-unknown-cube':         { enabled: true,  severity: 'warning' },
  'dimension-not-found':     { enabled: true,  severity: 'error' },
  'element-not-found':       { enabled: true,  severity: 'warning' },
  'feeder-db-on-lhs':        { enabled: true,  severity: 'error' },
  'feeder-missing-arrow':    { enabled: true,  severity: 'warning' },
  'feeder-missing-comma':    { enabled: true,  severity: 'error' },
  'feeder-multi-lhs':        { enabled: true,  severity: 'error' },
  'hierarchy-not-found':     { enabled: true,  severity: 'error' },
  'invalid-cell-ref-syntax': { enabled: true,  severity: 'hint' },
  'missing-semicolon':       { enabled: true,  severity: 'error' },
  'multiple-feeders':        { enabled: true,  severity: 'error' },
  'no-feeders-section':      { enabled: true,  severity: 'warning' },
  'parse-error':             { enabled: true,  severity: 'error' },
  'rule-after-feeders':      { enabled: true,  severity: 'warning' },
  'unclosed-bracket':        { enabled: true,  severity: 'error' },
  'unqualified-cell-ref':    { enabled: false, severity: 'hint' },
};

/** Human-readable grouping for the config panel. Every id appears exactly once. */
export const RULES_LINT_GROUPS: { key: string; ids: RulesLintRuleId[] }[] = [
  { key: 'syntax', ids: [
    'parse-error', 'missing-semicolon', 'unclosed-bracket',
    'invalid-cell-ref-syntax', 'unqualified-cell-ref',
  ] },
  { key: 'feeders', ids: [
    'no-feeders-section', 'multiple-feeders', 'rule-after-feeders',
    'feeder-missing-arrow', 'feeder-missing-comma', 'feeder-multi-lhs', 'feeder-db-on-lhs',
  ] },
  { key: 'db', ids: [
    'db-too-few-args', 'db-arg-count-mismatch', 'db-invalid-cube-arg',
    'db-conditional-cube-arg', 'db-unknown-cube', 'db-element-not-found',
  ] },
  { key: 'server', ids: [
    'dimension-not-found', 'hierarchy-not-found', 'element-not-found',
  ] },
];

/** Filter + re-severity diagnostics per config. Single decision point for all ruleIds. */
export function applyRulesLintConfig(
  diags: RulesLintDiagnose[],
  cfg: RulesLintConfig,
): RulesLintDiagnose[] {
  const out: RulesLintDiagnose[] = [];
  for (const d of diags) {
    const id = d.ruleId as RulesLintRuleId;
    const setting = cfg.rules[id];
    const def = RULES_LINT_DEFAULTS[id];
    // Unknown ids pass through enabled: a rule added to an emitter without a table
    // entry must not vanish silently — the union above is what catches that at build time.
    const enabled = setting?.enabled ?? def?.enabled ?? true;
    if (!enabled) { continue; }
    out.push(setting?.severity ? { ...d, severity: setting.severity } : d);
  }
  return out;
}

/** Effective full per-rule view (defaults overlaid by stored overrides) — for the config UI. */
export function mergeRulesLintConfig(
  stored: RulesLintConfig | undefined,
): Record<RulesLintRuleId, RuleDefault> {
  const merged = {} as Record<RulesLintRuleId, RuleDefault>;
  for (const id of Object.keys(RULES_LINT_DEFAULTS) as RulesLintRuleId[]) {
    const ov = stored?.rules[id];
    merged[id] = {
      enabled: ov?.enabled ?? RULES_LINT_DEFAULTS[id].enabled,
      severity: ov?.severity ?? RULES_LINT_DEFAULTS[id].severity,
    };
  }
  return merged;
}
