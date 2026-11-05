import { describe, it, expect } from 'vitest';
import { isReservedName } from '../../tiConsistency/reserved';

describe('isReservedName', () => {
  it('flags a TI SYSTEM datasource-config var (hardcoded via PROLOG_ONLY_ASSIGN)', () => {
    expect(isReservedName('datasourceasciithousandseparator')).toBe(true);
  });
  it('flags DatasourceType (hardcoded via PROLOG_ONLY_ASSIGN)', () => {
    expect(isReservedName('datasourcetype')).toBe(true);
  });
  it('does not flag an ordinary local var', () => {
    expect(isReservedName('sdim')).toBe(false);
  });
  it('flags a TI keyword', () => {
    expect(isReservedName('if')).toBe(true);
  });
});
