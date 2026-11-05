import { describe, it, expect } from 'vitest';
import {
  LINT_RULE_DEFAULTS, mergeLintConfig, applyLintRuleConfig,
  UNUSED_VAR_SECTION_DEFAULTS,
  type LintRuleConfig,
} from '../tiLogicVisualizer/tiLinter/ruleConfig';
import type { LintDiagnose } from '../tiLogicVisualizer/lintTypes';

const diag = (ruleId: string, severity = 'warning'): LintDiagnose =>
  ({ line: 1, severity, ruleId, message: `[${ruleId}] x` } as LintDiagnose);

describe('LINT_RULE_DEFAULTS', () => {
  it('has S-rules on and N/D off', () => {
    expect(LINT_RULE_DEFAULTS['exec-command-forbidden'].enabled).toBe(true);
    expect(LINT_RULE_DEFAULTS['var-naming-prefix'].enabled).toBe(false);
    expect(LINT_RULE_DEFAULTS['missing-docstring'].enabled).toBe(false);
    expect(LINT_RULE_DEFAULTS['param-naming-prefix'].enabled).toBe(false);
  });
  it('has every existing rule enabled by default', () => {
    expect(LINT_RULE_DEFAULTS['wrong-arg-count'].enabled).toBe(true);
    expect(LINT_RULE_DEFAULTS['unused-variable'].enabled).toBe(true);
  });
});

describe('applyLintRuleConfig', () => {
  const empty: LintRuleConfig = { rules: {} };
  it('keeps default-enabled rules unchanged (no forced severity)', () => {
    const out = applyLintRuleConfig([diag('wrong-arg-count', 'error')], empty);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
  });
  it('drops default-disabled rules (N/D off)', () => {
    expect(applyLintRuleConfig([diag('missing-docstring', 'info')], empty)).toHaveLength(0);
  });
  it('drops a rule the user disabled', () => {
    const cfg: LintRuleConfig = { rules: { 'wrong-arg-count': { enabled: false } } };
    expect(applyLintRuleConfig([diag('wrong-arg-count')], cfg)).toHaveLength(0);
  });
  it('applies a user severity override only when set', () => {
    const cfg: LintRuleConfig = { rules: { 'unknown-function': { enabled: true, severity: 'error' } } };
    expect(applyLintRuleConfig([diag('unknown-function', 'hint')], cfg)[0].severity).toBe('error');
  });
  it('passes through a ruleId absent from defaults', () => {
    expect(applyLintRuleConfig([diag('totally-unknown')], empty)).toHaveLength(1);
  });
});

describe('mergeLintConfig', () => {
  it('returns all defaults for undefined', () => {
    const m = mergeLintConfig(undefined);
    expect(m['exec-command-forbidden']).toEqual(LINT_RULE_DEFAULTS['exec-command-forbidden']);
    expect(m['var-naming-prefix'].enabled).toBe(false);
  });
  it('overlays a stored override', () => {
    const m = mergeLintConfig({ rules: { 'var-naming-prefix': { enabled: true, severity: 'warning' } } });
    expect(m['var-naming-prefix']).toEqual({ enabled: true, severity: 'warning' });
    expect(m['wrong-arg-count']).toEqual(LINT_RULE_DEFAULTS['wrong-arg-count']);
  });
});

describe('unused-variable per-section', () => {
  const uvDiag = (): LintDiagnose => ({ line: 1, severity: 'warning', ruleId: 'unused-variable', message: '[unused-variable] x' } as LintDiagnose);

  it('default: dropped in prolog/epilog, kept in metadata/data', () => {
    const empty = { rules: {} };
    expect(applyLintRuleConfig([uvDiag()], empty, 'prolog')).toHaveLength(0);
    expect(applyLintRuleConfig([uvDiag()], empty, 'epilog')).toHaveLength(0);
    expect(applyLintRuleConfig([uvDiag()], empty, 'metadata')).toHaveLength(1);
    expect(applyLintRuleConfig([uvDiag()], empty, 'data')).toHaveLength(1);
  });
  it('UNUSED_VAR_SECTION_DEFAULTS = M+D on, P+E off', () => {
    expect(UNUSED_VAR_SECTION_DEFAULTS).toEqual({ prolog: false, metadata: true, data: true, epilog: false });
  });
  it('user override re-enables prolog', () => {
    const cfg = { rules: {}, unusedVariableSections: { prolog: true } };
    expect(applyLintRuleConfig([uvDiag()], cfg, 'prolog')).toHaveLength(1);
  });
  it('user override disables data', () => {
    const cfg = { rules: {}, unusedVariableSections: { data: false } };
    expect(applyLintRuleConfig([uvDiag()], cfg, 'data')).toHaveLength(0);
  });
  it('without a section arg, unused-variable is not section-gated (back-compat)', () => {
    expect(applyLintRuleConfig([uvDiag()], { rules: {} })).toHaveLength(1);
  });
  it('global disable still wins over section default', () => {
    const cfg = { rules: { 'unused-variable': { enabled: false } } };
    expect(applyLintRuleConfig([uvDiag()], cfg, 'metadata')).toHaveLength(0);
  });
});
