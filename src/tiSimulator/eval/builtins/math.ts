/**
 * Numeric / trigonometric built-ins (2026-07-13, batch ⑦ common reads).
 *
 * All are pure 1-arg numeric functions — no fixture dependency, exact
 * semantics. TM1's LOG is the base-10 logarithm; LN is the natural log
 * (IBM PA docs). Angles are in radians. ROUND/ROUNDP/INT/RAND live in
 * string.ts (historical placement) and are not duplicated here.
 */

import { type Builtin, asNumber, expectArity } from './_helpers';

const unary = (name: string, fn: (x: number) => number): Builtin => ({
  name,
  invoke: (args) => {
    expectArity(name, args, 1);
    const r = fn(asNumber(args[0], name, 0));
    // Real TM1 aborts the process on an invalid-domain math call (e.g. SQRT(-4),
    // LN(0)). Returning 0 is a sim-safe fallback: it keeps the row alive without
    // leaking NaN/±Infinity into the Value type (which would surface as garbage
    // in string concat / TextOutput / diffs). Pending live verification of the
    // exact TM1 abort behavior.
    return Number.isFinite(r) ? r : 0;
  },
});

export const MATH_BUILTINS: Builtin[] = [
  unary('ABS', Math.abs),
  unary('SQRT', Math.sqrt),
  unary('EXP', Math.exp),
  unary('LN', Math.log),
  unary('LOG', Math.log10), // TM1 LOG = base-10
  unary('SIGN', Math.sign),
  unary('SIN', Math.sin),
  unary('COS', Math.cos),
  unary('TAN', Math.tan),
  unary('ASIN', Math.asin),
  unary('ACOS', Math.acos),
  unary('ATAN', Math.atan),
  ...(['MIN', 'MAX'] as const).map((name): Builtin => ({
    name,
    invoke: (args) => {
      expectArity(name, args, 2);
      const a = asNumber(args[0], name, 0);
      const b = asNumber(args[1], name, 1);
      return name === 'MIN' ? Math.min(a, b) : Math.max(a, b);
    },
  })),
];
