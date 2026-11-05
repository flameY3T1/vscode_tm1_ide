import { describe, it, expect } from 'vitest';
import { normalizeLintConfig } from '../commands/processEditor/lintConfigStore';

describe('normalizeLintConfig', () => {
  it('returns an empty rules map for undefined', () => {
    expect(normalizeLintConfig(undefined)).toEqual({ rules: {} });
  });
  it('preserves a stored rules map', () => {
    const c = { rules: { 'wrong-arg-count': { enabled: false } } };
    expect(normalizeLintConfig(c as never)).toEqual(c);
  });
  it('preserves unusedVariableSections and namingPrefixes', () => {
    const c = {
      rules: { 'unused-variable': { enabled: true } },
      unusedVariableSections: { prolog: true, metadata: false, data: false, epilog: true },
      namingPrefixes: { numeric: 'num', string: 'str', param: 'p', datasource: 'ds' },
    };
    expect(normalizeLintConfig(c as never)).toEqual(c);
  });
});
