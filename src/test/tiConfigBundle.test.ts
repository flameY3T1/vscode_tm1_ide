import { describe, it, expect } from 'vitest';
import {
  buildBundle, parseBundle, BUNDLE_TYPE, BUNDLE_VERSION,
} from '../commands/processEditor/tiConfigBundle';
import { DEFAULT_FORMAT_CONFIG } from '../tiLogicVisualizer/formatRules';
import { DEFAULT_RULE_FORMAT_CONFIG } from '../tiLogicVisualizer/formatRulesText';

const lint = {
  rules: { 'wrong-arg-count': { enabled: false } },
  unusedVariableSections: { prolog: true, metadata: false, data: false, epilog: true },
  namingPrefixes: { numeric: 'num', string: 'str', param: 'p', datasource: 'ds' },
};

describe('buildBundle', () => {
  it('wraps the three configs with type/version/timestamp', () => {
    const b = buildBundle(lint as never, DEFAULT_FORMAT_CONFIG, DEFAULT_RULE_FORMAT_CONFIG, '2026-06-25T08:00:00.000Z');
    expect(b.$type).toBe(BUNDLE_TYPE);
    expect(b.version).toBe(BUNDLE_VERSION);
    expect(b.exportedAt).toBe('2026-06-25T08:00:00.000Z');
    expect(b.lintConfig).toBe(lint);
    expect(b.formatConfig).toBe(DEFAULT_FORMAT_CONFIG);
    expect(b.ruleFormatConfig).toBe(DEFAULT_RULE_FORMAT_CONFIG);
  });
});

describe('parseBundle', () => {
  it('round-trips a built bundle, preserving lint sections + prefixes', () => {
    const json = JSON.stringify(buildBundle(lint as never, DEFAULT_FORMAT_CONFIG, DEFAULT_RULE_FORMAT_CONFIG, 'x'));
    const r = parseBundle(json);
    expect(r.ok).toBe(true);
    if (!r.ok) { return; }
    expect(r.lint).toEqual(lint);
    expect(r.format).toEqual(DEFAULT_FORMAT_CONFIG);
    expect(r.ruleFormat).toEqual(DEFAULT_RULE_FORMAT_CONFIG);
  });

  it('rejects malformed JSON', () => {
    expect(parseBundle('{not json')).toEqual({ ok: false, error: 'invalid' });
  });

  it('rejects a wrong / missing $type', () => {
    expect(parseBundle(JSON.stringify({ lintConfig: lint }))).toEqual({ ok: false, error: 'wrongType' });
    expect(parseBundle(JSON.stringify({ $type: 'something-else', lintConfig: lint }))).toEqual({ ok: false, error: 'wrongType' });
  });

  it('omits blocks that are absent from the file', () => {
    const json = JSON.stringify({ $type: BUNDLE_TYPE, version: 1, lintConfig: lint });
    const r = parseBundle(json);
    expect(r.ok).toBe(true);
    if (!r.ok) { return; }
    expect(r.lint).toEqual(lint);
    expect(r.format).toBeUndefined();
    expect(r.ruleFormat).toBeUndefined();
  });

  it('backfills partial format blocks with defaults', () => {
    const json = JSON.stringify({
      $type: BUNDLE_TYPE,
      formatConfig: { enabled: { 'keyword-case': false } },
      ruleFormatConfig: { parenStyle: 'spaced' },
    });
    const r = parseBundle(json);
    expect(r.ok).toBe(true);
    if (!r.ok) { return; }
    expect(r.format?.enabled['keyword-case']).toBe(false);
    // an unspecified flag falls back to the default
    expect(r.format?.enabled['block-indent']).toBe(DEFAULT_FORMAT_CONFIG.enabled['block-indent']);
    expect(r.ruleFormat?.parenStyle).toBe('spaced');
  });

  it('drops a lint block with no rules map', () => {
    const json = JSON.stringify({ $type: BUNDLE_TYPE, lintConfig: { foo: 1 } });
    const r = parseBundle(json);
    expect(r.ok).toBe(true);
    if (!r.ok) { return; }
    expect(r.lint).toBeUndefined();
  });
});
