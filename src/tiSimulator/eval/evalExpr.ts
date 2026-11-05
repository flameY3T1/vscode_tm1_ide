/**
 * Expression evaluator. Walks the Expr AST against a Scope + builtins
 * registry, applying TI-flavoured coercion rules:
 *  - empty string in numeric context = 0
 *  - `|` always concatenates as strings (numbers stringified)
 *  - `+`,`-`,`*`,`/` always numeric (operands coerced)
 */

import type { Expr } from '../ast/expr';
import type { Value, Fixtures } from '../types';
import type { Scope } from './scope';
import { findBuiltin } from './builtins';

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalError';
  }
}

function asNumber(v: Value, op: string): number {
  if (typeof v === 'number') return v;
  if (v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new EvalError(`${op}: cannot coerce '${v}' to number`);
  }
  return n;
}

function asString(v: Value): string {
  return typeof v === 'string' ? v : String(v);
}

function lookupCaseInsensitive(scope: Scope, name: string): Value | undefined {
  if (scope.has(name)) return scope.get(name);
  const lower = name.toLowerCase();
  let s: Scope | undefined = scope;
  while (s) {
    for (const [k, v] of s.ownEntries()) {
      if (k.toLowerCase() === lower) return v;
    }
    s = s.parent;
  }
  return undefined;
}

export function evalExpr(expr: Expr, scope: Scope, fixtures?: Fixtures): Value {
  switch (expr.kind) {
    case 'numLit':
      return expr.value;
    case 'strLit':
      return expr.value;
    case 'paren':
      return evalExpr(expr.inner, scope, fixtures);
    case 'ident': {
      const v = lookupCaseInsensitive(scope, expr.name);
      return v ?? '';
    }
    case 'unary': {
      const inner = asNumber(evalExpr(expr.expr, scope, fixtures), `unary ${expr.op}`);
      return expr.op === '-' ? -inner : inner;
    }
    case 'binary': {
      const l = evalExpr(expr.left, scope, fixtures);
      const r = evalExpr(expr.right, scope, fixtures);
      switch (expr.op) {
        case '|':
          return asString(l) + asString(r);
        case ':':
          // `hier:elem` qualifier — kept as one string with `:` separator
          // so downstream calls (CellIsUpdateable etc.) receive a usable
          // identifier even when the simulator lacks hier-aware fixtures.
          return asString(l) + ':' + asString(r);
        case '+':
          return asNumber(l, '+') + asNumber(r, '+');
        case '-':
          return asNumber(l, '-') - asNumber(r, '-');
        case '*':
          return asNumber(l, '*') * asNumber(r, '*');
        case '/': {
          const rn = asNumber(r, '/');
          if (rn === 0) throw new EvalError('division by zero');
          return asNumber(l, '/') / rn;
        }
        case '\\': {
          // TM1 '\' is REAL (float) division — TM1 has no integer type, so it
          // does NOT truncate (`7 \ 2 === 3.5`). It differs from '/' only in
          // that a zero divisor returns 0 instead of erroring (IBM: "Division
          // by zero using this operator returns zero").
          const rn = asNumber(r, '\\');
          if (rn === 0) return 0;
          return asNumber(l, '\\') / rn;
        }
        case '=':
          return asNumber(l, '=') === asNumber(r, '=') ? 1 : 0;
        case '<>':
          return asNumber(l, '<>') !== asNumber(r, '<>') ? 1 : 0;
        case '<':
          return asNumber(l, '<') < asNumber(r, '<') ? 1 : 0;
        case '>':
          return asNumber(l, '>') > asNumber(r, '>') ? 1 : 0;
        case '<=':
          return asNumber(l, '<=') <= asNumber(r, '<=') ? 1 : 0;
        case '>=':
          return asNumber(l, '>=') >= asNumber(r, '>=') ? 1 : 0;
        case '@=':
          return asString(l).toLowerCase() === asString(r).toLowerCase() ? 1 : 0;
        case '@<>':
          return asString(l).toLowerCase() !== asString(r).toLowerCase() ? 1 : 0;
        case '&':
          return asNumber(l, '&') !== 0 && asNumber(r, '&') !== 0 ? 1 : 0;
        case '%':
          return asNumber(l, '%') !== 0 || asNumber(r, '%') !== 0 ? 1 : 0;
      }
      throw new EvalError(`unknown binary op`);
    }
    case 'call': {
      // TM1 Expand('%var%') substitutes `%name%` placeholders with the
      // current scope value of `name`. Needs scope access — handled inline
      // here rather than via the builtin registry (which is scope-blind).
      if (expr.name.toLowerCase() === 'expand') {
        const args = expr.args.map((a) => evalExpr(a, scope, fixtures));
        const tmpl = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
        return tmpl.replace(/%([\p{L}_][\p{L}\p{N}_]*)%/gu, (_m, name: string) => {
          const v = lookupCaseInsensitive(scope, name);
          if (v === undefined) return '';
          return typeof v === 'number' ? String(v) : v;
        });
      }
      const builtin = findBuiltin(expr.name);
      if (!builtin) {
        throw new EvalError(`unknown function '${expr.name}'`);
      }
      const args = expr.args.map((a) => evalExpr(a, scope, fixtures));
      return builtin.invoke(args, fixtures);
    }
  }
}
