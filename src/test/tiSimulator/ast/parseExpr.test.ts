import { describe, it, expect } from 'vitest';
import { parseExpression, ParseError } from '../../../tiSimulator/ast/parseExpr';

describe('parseExpression', () => {
  it('parses a number literal', () => {
    expect(parseExpression('42')).toEqual({ kind: 'numLit', value: 42 });
  });

  it('parses a decimal number', () => {
    expect(parseExpression('3.14')).toEqual({ kind: 'numLit', value: 3.14 });
  });

  it('parses a string literal', () => {
    expect(parseExpression(`'foo'`)).toEqual({ kind: 'strLit', value: 'foo' });
  });

  it('parses doubled-quote escape inside string', () => {
    expect(parseExpression(`'it''s'`)).toEqual({ kind: 'strLit', value: `it's` });
  });

  it('parses identifier', () => {
    expect(parseExpression('myVar')).toEqual({ kind: 'ident', name: 'myVar' });
  });

  it('parses parenthesised expression', () => {
    const r = parseExpression('(1 + 2)');
    expect(r.kind).toBe('paren');
  });

  it('parses unary minus', () => {
    const r = parseExpression('-5');
    expect(r).toEqual({
      kind: 'unary',
      op: '-',
      expr: { kind: 'numLit', value: 5 },
    });
  });

  it('parses addition left-associative', () => {
    const r = parseExpression('1 + 2 + 3');
    expect(r).toEqual({
      kind: 'binary',
      op: '+',
      left: {
        kind: 'binary',
        op: '+',
        left: { kind: 'numLit', value: 1 },
        right: { kind: 'numLit', value: 2 },
      },
      right: { kind: 'numLit', value: 3 },
    });
  });

  it('parses precedence: * binds tighter than +', () => {
    const r = parseExpression('1 + 2 * 3');
    expect(r).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'numLit', value: 1 },
      right: {
        kind: 'binary',
        op: '*',
        left: { kind: 'numLit', value: 2 },
        right: { kind: 'numLit', value: 3 },
      },
    });
  });

  it('parses concat | with lowest precedence', () => {
    const r = parseExpression(`'a' | 1 + 2`);
    expect(r).toEqual({
      kind: 'binary',
      op: '|',
      left: { kind: 'strLit', value: 'a' },
      right: {
        kind: 'binary',
        op: '+',
        left: { kind: 'numLit', value: 1 },
        right: { kind: 'numLit', value: 2 },
      },
    });
  });

  it('parses parens overriding precedence', () => {
    const r = parseExpression('(1 + 2) * 3');
    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.op).toBe('*');
    expect(r.left.kind).toBe('paren');
  });

  it('parses function call with no args', () => {
    const r = parseExpression('Now()');
    expect(r).toEqual({ kind: 'call', name: 'Now', args: [] });
  });

  it('parses function call with multiple args', () => {
    const r = parseExpression(`SUBST('hello', 1, 3)`);
    expect(r.kind).toBe('call');
    if (r.kind !== 'call') return;
    expect(r.name).toBe('SUBST');
    expect(r.args).toHaveLength(3);
  });

  it('parses nested function calls', () => {
    const r = parseExpression(`NumberToString(StringToNumber('42'))`);
    expect(r.kind).toBe('call');
    if (r.kind !== 'call') return;
    expect(r.name).toBe('NumberToString');
    expect(r.args[0].kind).toBe('call');
  });

  it('skips line + block comments', () => {
    const r = parseExpression('1 # plus 2\n + /* yo */ 3');
    expect(r.kind).toBe('binary');
  });

  it('throws on unterminated string', () => {
    expect(() => parseExpression(`'unterminated`)).toThrow(ParseError);
  });

  it('throws on trailing garbage', () => {
    expect(() => parseExpression('1 + 2 garbage')).toThrow(ParseError);
  });

  it('throws on invalid character', () => {
    expect(() => parseExpression('1 @ 2')).toThrow(ParseError);
  });

  it('parses string concat with identifier', () => {
    const r = parseExpression(`'prefix-' | name | '-suffix'`);
    expect(r.kind).toBe('binary');
  });

  it('handles whitespace flexibly', () => {
    expect(parseExpression('   1   +   2   ')).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'numLit', value: 1 },
      right: { kind: 'numLit', value: 2 },
    });
  });

  it('parses double unary', () => {
    const r = parseExpression('--5');
    expect(r.kind).toBe('unary');
  });
});
