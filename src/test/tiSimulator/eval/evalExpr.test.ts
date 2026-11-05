import { describe, it, expect } from 'vitest';
import { evalExpr, EvalError } from '../../../tiSimulator/eval/evalExpr';
import { Scope } from '../../../tiSimulator/eval/scope';
import { parseExpression } from '../../../tiSimulator/ast/parseExpr';

const ev = (src: string, vars: Record<string, number | string> = {}) => {
  const s = new Scope();
  for (const [k, v] of Object.entries(vars)) s.set(k, v);
  return evalExpr(parseExpression(src), s);
};

describe('evalExpr', () => {
  it('evaluates literals', () => {
    expect(ev('42')).toBe(42);
    expect(ev(`'foo'`)).toBe('foo');
  });

  it('evaluates identifier from scope', () => {
    expect(ev('x', { x: 10 })).toBe(10);
  });

  it('returns empty string for undeclared identifier (TI semantics)', () => {
    expect(ev('undef')).toBe('');
  });

  it('case-insensitive identifier lookup', () => {
    expect(ev('MyVar', { myvar: 5 })).toBe(5);
  });

  it('arithmetic + - * /', () => {
    expect(ev('1 + 2')).toBe(3);
    expect(ev('5 - 3')).toBe(2);
    expect(ev('4 * 3')).toBe(12);
    expect(ev('10 / 4')).toBe(2.5);
  });

  it('throws on division by zero', () => {
    expect(() => ev('1 / 0')).toThrow(EvalError);
  });

  it('backslash is real (float) division, not integer', () => {
    // TM1 '\' is real division (no integer type); 7 \ 2 = 3.5, NOT 3.
    expect(ev('7 \\ 2')).toBe(3.5);
    expect(ev('10 \\ 4')).toBe(2.5);
  });

  it('backslash division by zero returns 0 (no error), unlike /', () => {
    // IBM: "Division by zero using this operator returns zero."
    expect(ev('1 \\ 0')).toBe(0);
    expect(ev('123 \\ 0')).toBe(0);
  });

  it('string concat with |', () => {
    expect(ev(`'foo' | 'bar'`)).toBe('foobar');
    expect(ev(`'val=' | 42`)).toBe('val=42');
  });

  it('coerces empty string to 0 in numeric context', () => {
    expect(ev(`'' + 5`)).toBe(5);
  });

  it('throws on non-numeric coercion', () => {
    expect(() => ev(`'abc' + 1`)).toThrow(EvalError);
  });

  it('unary minus', () => {
    expect(ev('-5')).toBe(-5);
    expect(ev('-(1+2)')).toBe(-3);
  });

  it('precedence', () => {
    expect(ev('2 + 3 * 4')).toBe(14);
    expect(ev('(2 + 3) * 4')).toBe(20);
  });

  it('builtin call', () => {
    expect(ev(`NumberToString(42)`)).toBe('42');
    expect(ev(`SUBST('hello', 2, 3)`)).toBe('ell');
  });

  it('throws on unknown function', () => {
    expect(() => ev(`UnknownFunc()`)).toThrow(EvalError);
  });

  it('nested expression with vars + builtins', () => {
    expect(ev(`'sum=' | NumberToString(a + b)`, { a: 2, b: 3 })).toBe('sum=5');
  });

  it('parenthesised concat', () => {
    expect(ev(`('a' | 'b') | 'c'`)).toBe('abc');
  });
});
