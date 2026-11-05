import { describe, it, expect } from 'vitest';
import { getTiContextEndpoint } from '../providers/tiContextPatternsPure';

describe('getTiContextEndpoint', () => {
  describe('Cubes endpoint', () => {
    it('matches CellGetN with cursor inside first arg (CubeName)', () => {
      expect(getTiContextEndpoint("CellGetN('")).toBe('Cubes');
      expect(getTiContextEndpoint("CellGetN('Sale")).toBe('Cubes');
    });

    it('matches CellGetS with cursor inside first arg', () => {
      expect(getTiContextEndpoint("CellGetS('")).toBe('Cubes');
    });

    it('is case-insensitive', () => {
      expect(getTiContextEndpoint("cellgetn('")).toBe('Cubes');
      expect(getTiContextEndpoint("CELLGETN('Foo")).toBe('Cubes');
    });

    it('matches with surrounding code', () => {
      expect(getTiContextEndpoint("v = CellGetN('")).toBe('Cubes');
      expect(getTiContextEndpoint("  IF (CellGetN('Sa")).toBe('Cubes');
    });
  });

  describe('Dimensions endpoint', () => {
    it('matches DimensionElementInsert with cursor inside first arg', () => {
      expect(getTiContextEndpoint("DimensionElementInsert('")).toBe('Dimensions');
    });

    it('matches DimensionDeleteAllElements', () => {
      expect(getTiContextEndpoint("DimensionDeleteAllElements('Sales_Dim")).toBe('Dimensions');
    });
  });

  describe('Processes endpoint', () => {
    it('matches ExecuteProcess with cursor inside first arg (ProcessName)', () => {
      expect(getTiContextEndpoint("ExecuteProcess('")).toBe('Processes');
      expect(getTiContextEndpoint("ExecuteProcess('Daily_")).toBe('Processes');
    });

    it('matches RuleLoadFromFile (CubeName) — sanity that Processes do not bleed', () => {
      expect(getTiContextEndpoint("RuleLoadFromFile('")).toBe('Cubes');
    });
  });

  describe('null cases', () => {
    it('returns null for non-function text', () => {
      expect(getTiContextEndpoint('random text')).toBeNull();
      expect(getTiContextEndpoint('')).toBeNull();
      expect(getTiContextEndpoint('// just a comment')).toBeNull();
    });

    it('returns null when string is closed before cursor', () => {
      expect(getTiContextEndpoint("CellGetN('Sales')")).toBeNull();
    });

    it('returns null when cursor sits in a non-name argument position', () => {
      // CellGetN: idx 0 = CubeName, idx 1+ = dim element strings → no rule fires
      expect(getTiContextEndpoint("CellGetN('Sales', '")).toBeNull();
    });

    it('returns null for unknown function name', () => {
      expect(getTiContextEndpoint("UnknownFunction('")).toBeNull();
    });
  });

  describe('argument-position handling', () => {
    it('handles whitespace around commas and parens', () => {
      expect(getTiContextEndpoint("CellGetN  (  '")).toBe('Cubes');
      expect(getTiContextEndpoint("CellGetN(   'Sa")).toBe('Cubes');
    });

    it('still matches arg 0 when only one quote is open', () => {
      expect(getTiContextEndpoint("CellGetN('Sa")).toBe('Cubes');
    });
  });
});
