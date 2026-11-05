import { describe, it, expect } from 'vitest';
import { parseSpreadToken } from '../../cubeViewer/spreadTokenParser';

describe('parseSpreadToken', () => {
  it('returns null for empty / whitespace', () => {
    expect(parseSpreadToken('')).toBeNull();
    expect(parseSpreadToken('   ')).toBeNull();
  });

  it('returns null for plain numbers and strings', () => {
    expect(parseSpreadToken('42')).toBeNull();
    expect(parseSpreadToken('-5.5')).toBeNull();
    expect(parseSpreadToken('abc')).toBeNull();
  });

  it('~~ → Clear', () => {
    expect(parseSpreadToken('~~')).toEqual({ method: 'clear', value: 0 });
  });

  it('~ alone is null (needs a number)', () => {
    expect(parseSpreadToken('~')).toBeNull();
  });

  it('~N → Proportional(N)', () => {
    expect(parseSpreadToken('~100')).toEqual({ method: 'proportional', value: 100 });
    expect(parseSpreadToken('~-50')).toEqual({ method: 'proportional', value: -50 });
    expect(parseSpreadToken('~3.14')).toEqual({ method: 'proportional', value: 3.14 });
  });

  it('%N → Percentage(N)', () => {
    expect(parseSpreadToken('%10')).toEqual({ method: 'percentage', value: 10 });
    expect(parseSpreadToken('%-10')).toEqual({ method: 'percentage', value: -10 });
  });

  it('/N → null (Equal not in v1.8.0)', () => {
    expect(parseSpreadToken('/50')).toBeNull();
    expect(parseSpreadToken('/0.5')).toBeNull();
  });

  it('!N → Repeat(N)', () => {
    expect(parseSpreadToken('!25')).toEqual({ method: 'repeat', value: 25 });
    expect(parseSpreadToken('!-7')).toEqual({ method: 'repeat', value: -7 });
  });

  it('+N and *N are NOT supported (Architect-only, not REST)', () => {
    expect(parseSpreadToken('+55')).toBeNull();
    expect(parseSpreadToken('*55')).toBeNull();
    expect(parseSpreadToken('*1.5')).toBeNull();
  });

  it('token with garbage suffix returns null', () => {
    expect(parseSpreadToken('~100abc')).toBeNull();
    expect(parseSpreadToken('%foo')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseSpreadToken('  ~100  ')).toEqual({ method: 'proportional', value: 100 });
  });
});
