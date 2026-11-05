import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  RULES_LINT_DEFAULTS, RULES_LINT_GROUPS, applyRulesLintConfig, mergeRulesLintConfig,
  type RulesLintConfig, type RulesLintRuleId,
} from '../tiLogicVisualizer/rulesLinter/ruleConfig';
import type { RulesLintDiagnose } from '../tiLogicVisualizer/rulesLinter';

const diag = (ruleId: string, severity: RulesLintDiagnose['severity'] = 'error'): RulesLintDiagnose =>
  ({ line: 0, severity, ruleId });

describe('applyRulesLintConfig', () => {
  it('lets everything through under the defaults that is on by default', () => {
    const diags = [diag('parse-error'), diag('missing-semicolon')];
    expect(applyRulesLintConfig(diags, { rules: {} })).toEqual(diags);
  });

  it('filters out a disabled rule', () => {
    const cfg: RulesLintConfig = { rules: { 'parse-error': { enabled: false } } };
    const out = applyRulesLintConfig([diag('parse-error'), diag('missing-semicolon')], cfg);
    expect(out.map(d => d.ruleId)).toEqual(['missing-semicolon']);
  });

  it('applies an explicitly overridden severity', () => {
    const cfg: RulesLintConfig = { rules: { 'missing-semicolon': { enabled: true, severity: 'hint' } } };
    const [out] = applyRulesLintConfig([diag('missing-semicolon', 'error')], cfg);
    expect(out.severity).toBe('hint');
  });

  it('NEVER forces the default severity — without an override the emitter\'s severity stays', () => {
    // The emitter assigns different severities for the same id depending on the
    // situation; the table only states the nominal value for the picklist.
    const [out] = applyRulesLintConfig([diag('parse-error', 'warning')], { rules: {} });
    expect(out.severity).toBe('warning');
  });

  it('lets an unknown rule id through instead of silently swallowing it', () => {
    const [out] = applyRulesLintConfig([diag('gibt-es-nicht')], { rules: {} });
    expect(out.ruleId).toBe('gibt-es-nicht');
  });

  it('unqualified-cell-ref is OFF by default and gets filtered', () => {
    expect(RULES_LINT_DEFAULTS['unqualified-cell-ref'].enabled).toBe(false);
    expect(applyRulesLintConfig([diag('unqualified-cell-ref', 'hint')], { rules: {} })).toEqual([]);
  });

  it('and can be switched on', () => {
    const cfg: RulesLintConfig = { rules: { 'unqualified-cell-ref': { enabled: true } } };
    expect(applyRulesLintConfig([diag('unqualified-cell-ref', 'hint')], cfg)).toHaveLength(1);
  });
});

describe('mergeRulesLintConfig', () => {
  it('lays stored overrides over the defaults', () => {
    const merged = mergeRulesLintConfig({ rules: { 'parse-error': { enabled: false, severity: 'hint' } } });
    expect(merged['parse-error']).toEqual({ enabled: false, severity: 'hint' });
    expect(merged['missing-semicolon']).toEqual(RULES_LINT_DEFAULTS['missing-semicolon']);
  });

  it('copes with undefined', () => {
    expect(mergeRulesLintConfig(undefined)).toEqual(RULES_LINT_DEFAULTS);
  });
});

describe('RULES_LINT_GROUPS', () => {
  it('assigns every rule to exactly one group', () => {
    const ids = RULES_LINT_GROUPS.flatMap(g => g.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual((Object.keys(RULES_LINT_DEFAULTS) as RulesLintRuleId[]).sort());
  });
});

/**
 * Guard against drift: the union in ruleConfig.ts catches a missing table row
 * at compile time — but only for ids that SOMEONE has entered into the union. A
 * new `ruleId: 'foo'` in an emitter does NOT stand out there, because the
 * diagnostic object carries `ruleId: string`. Hence the source scan over the
 * emitters here.
 */
describe('Rule ids of the emitters', () => {
  it('every ruleId assigned in rulesLinter is in RULES_LINT_DEFAULTS', () => {
    const dir = join(__dirname, '../tiLogicVisualizer/rulesLinter');
    const emitted = new Set<string>();
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts') && n !== 'ruleConfig.ts')) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/ruleId:\s*'([a-z0-9-]+)'/g)) { emitted.add(m[1]); }
      // Ternary form: ruleId: cond ? 'a' : 'b'
      for (const m of src.matchAll(/ruleId:[^,\n]*\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g)) {
        emitted.add(m[1]); emitted.add(m[2]);
      }
    }
    expect(emitted.size).toBeGreaterThan(15);
    const fehlend = [...emitted].filter(id => !(id in RULES_LINT_DEFAULTS));
    expect(fehlend).toEqual([]);
  });
});
