import { describe, it, expect } from 'vitest';
import { serializeRules, parseRules } from '../../git/serializer';

describe('serializer (rules)', () => {
  it('serializes plain rules text identically', () => {
    const rules = "['Sales','Jan'] = N: 100;\nFEEDERS;\n['Sales'] => DB('Sales','Jan');";
    expect(serializeRules(rules)).toBe(rules);
  });

  it('parses identical to input', () => {
    const rules = 'C: V > 0 ? V * 1.1 : 0;';
    expect(parseRules(rules)).toBe(rules);
  });

  it('handles empty rules', () => {
    expect(serializeRules('')).toBe('');
    expect(parseRules('')).toBe('');
  });

  it('round-trips multi-line rules with blank lines', () => {
    const rules = "['A'] = N: 1;\n\nFEEDERS;\n\n['B'] => DB('Cube','X');\n";
    expect(parseRules(serializeRules(rules))).toBe(rules);
  });
});
