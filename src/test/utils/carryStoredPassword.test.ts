import { describe, it, expect } from 'vitest';
import { carryStoredPassword } from '../../utils/dataSourceWire';

/**
 * "Save as…" creates a process that does not exist yet, so the PATCH merge that
 * normally preserves the ODBC password has nothing to merge with. The ciphertext
 * TM1 hands out is process-independent and round-trips verbatim (live-measured
 * 11.8, odbcPasswordCrossProcessProbe.js), so the copy carries it.
 */
describe('carryStoredPassword', () => {
  const SOURCE_CIPHER = 'GI7KsxswXthjWUiGl7l5TyoyvEnwR9GWkUgop6XhodA=';

  it('fills the missing password of an ODBC payload from the source process', () => {
    const wire = { Type: 'ODBC', dataSourceNameForServer: 'DSN', userName: 'u', query: 'SELECT 1' };
    expect(carryStoredPassword(wire, SOURCE_CIPHER)).toEqual({
      Type: 'ODBC',
      dataSourceNameForServer: 'DSN',
      userName: 'u',
      query: 'SELECT 1',
      password: SOURCE_CIPHER,
    });
  });

  it('does not mutate the payload it was handed', () => {
    const wire = { Type: 'ODBC', userName: 'u' };
    carryStoredPassword(wire, SOURCE_CIPHER);
    expect(wire).toEqual({ Type: 'ODBC', userName: 'u' });
  });

  it('keeps a password the user typed into the form', () => {
    const wire = { Type: 'ODBC', password: 'TypedByHand' };
    expect(carryStoredPassword(wire, SOURCE_CIPHER).password).toBe('TypedByHand');
  });

  it('leaves the payload alone when the source has no stored password', () => {
    const wire = { Type: 'ODBC', userName: 'u' };
    for (const empty of [undefined, '', null, 42]) {
      expect(carryStoredPassword(wire, empty)).toEqual(wire);
    }
  });

  it('treats an empty form password as "not set" rather than as an override', () => {
    const wire = { Type: 'ODBC', password: '' };
    expect(carryStoredPassword(wire, SOURCE_CIPHER).password).toBe(SOURCE_CIPHER);
  });

  it('touches nothing but ODBC — other types have no password field on the wire', () => {
    for (const Type of ['ASCII', 'None', 'TM1CubeView', 'TM1DimensionSubset']) {
      const wire = { Type, asciiDelimiterChar: ',' };
      expect(carryStoredPassword(wire, SOURCE_CIPHER)).toEqual(wire);
    }
  });
});
