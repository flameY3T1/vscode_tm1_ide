import { describe, it, expect } from 'vitest';
import { normalizeIdentifierCase } from '../tiLogicVisualizer/formatRules';

describe('normalizeIdentifierCase', () => {
  const canon = new Map([['vcount', 'vCount']]);

  it('rewrites code identifiers to canonical spelling', () => {
    expect(normalizeIdentifierCase('vcount = VCOUNT + 1;', canon)).toBe('vCount = vCount + 1;');
  });
  it('leaves string contents and comments untouched', () => {
    expect(normalizeIdentifierCase("sX = 'vcount'; # vcount", canon)).toBe("sX = 'vcount'; # vcount");
  });
  it('is a no-op for an empty map', () => {
    expect(normalizeIdentifierCase('vcount = 1;', new Map())).toBe('vcount = 1;');
  });
});
