import { describe, it, expect } from 'vitest';
import { normStmt, matchStatementLine } from '../../webviewClient/cellTrace/ruleLines';

describe('normStmt', () => {
  it('strips all whitespace', () => {
    expect(normStmt('  N: 1 = 2  ;\t')).toBe('N:1=2;');
  });
});

describe('matchStatementLine', () => {
  const rules = [
    '# comment',
    "N: X = 1;",
    '',
    "N: Y = X + 1;",
    "N: Z =",
    "  Y * 2;",
  ].join('\n');

  it('returns 1-based line number for an exact single-line match', () => {
    expect(matchStatementLine(rules, 'N: X = 1;')).toBe(2);
  });

  it('ignores whitespace differences', () => {
    expect(matchStatementLine(rules, '  N:   Y=X+1 ;  ')).toBe(4);
  });

  it('matches a statement split across multiple source lines to its first line', () => {
    expect(matchStatementLine(rules, 'N: Z = Y * 2;')).toBe(5);
  });

  it('returns null when the statement is not found', () => {
    expect(matchStatementLine(rules, 'N: NoSuchStatement = 42;')).toBeNull();
  });

  it('returns null for an empty statement', () => {
    expect(matchStatementLine(rules, '')).toBeNull();
    expect(matchStatementLine(rules, '   ')).toBeNull();
  });
});
