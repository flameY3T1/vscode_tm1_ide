import { describe, it, expect } from 'vitest';
import { SPREAD_METHODS, type SpreadMethod } from '../../cubeViewer/spreadMethods';

describe('spreadMethods', () => {
  it('exposes 4 methods with stable keys (Equal dropped per live probe)', () => {
    const keys = Object.keys(SPREAD_METHODS).sort();
    expect(keys).toEqual(['clear', 'percentage', 'proportional', 'repeat']);
  });

  it('methods except clear need a value', () => {
    expect(SPREAD_METHODS.proportional.needsValue).toBe(true);
    expect(SPREAD_METHODS.percentage.needsValue).toBe(true);
    expect(SPREAD_METHODS.repeat.needsValue).toBe(true);
    expect(SPREAD_METHODS.clear.needsValue).toBe(false);
  });

  it('exposes a PAW code prefix per method (literal "R0" for clear)', () => {
    expect(SPREAD_METHODS.proportional.codePrefix).toBe('P');
    expect(SPREAD_METHODS.percentage.codePrefix).toBe('R%');
    expect(SPREAD_METHODS.repeat.codePrefix).toBe('LR');
    expect(SPREAD_METHODS.clear.codePrefix).toBe('R0');
  });

  // There used to be a second, German set of labels here. It was
  // read nowhere — the webview takes `L.spread*` from `cubeViewerL10n`.
  it('no longer carries its own labels', () => {
    for (const m of Object.values(SPREAD_METHODS)) {
      expect(m).not.toHaveProperty('label');
    }
  });

  it('SpreadMethod type covers all 4 keys', () => {
    const ids: SpreadMethod[] = ['proportional', 'percentage', 'repeat', 'clear'];
    expect(ids).toHaveLength(4);
  });
});
