/**
 * Shared helpers for the simulator's TI built-in registry.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * All identifiers stay package-private (underscore-prefixed file) — only
 * category modules in the same dir consume them.
 */

import type { Value, Fixtures } from '../../types';

export type Builtin = {
  name: string;
  invoke: (args: Value[], fixtures?: Fixtures) => Value;
};

export function findDimElementIndex(
  fixtures: Fixtures | undefined,
  dim: string,
  name: string,
): number {
  if (!fixtures) return 0;
  const elems = fixtures.dimensions.get(dim);
  if (!elems) {
    throw new Error(
      `DIMIX: dimension '${dim}' has no fixture data — check input/dim-fixtures.json`,
    );
  }
  if (elems.length === 0) {
    throw new Error(
      `DIMIX: dimension '${dim}' fixture is empty — re-capture or use Replace TI from Server`,
    );
  }
  const lower = name.toLowerCase();
  for (let i = 0; i < elems.length; i++) {
    if (elems[i].name.toLowerCase() === lower) return i + 1;
  }
  return 0;
}

/**
 * TM1's NumberToString: 15 significant digits, at most 9 decimals, trailing
 * zeros dropped (measured on 11.8 and v12, 2026-10-19: 1/3 → 0,333333333,
 * 123456789.123456789 → 123456789,123457, 1e-10 → 0, 1e20 → all digits).
 */
export const numToStr = (v: Value): string => {
  if (typeof v !== 'number') return v;
  if (!Number.isFinite(v)) return String(v);
  const intDigits = Math.abs(v) >= 1 ? Math.floor(Math.log10(Math.abs(v))) + 1 : 0;
  // toFixed switches to exponent notation from 1e21 on; BigInt keeps every digit.
  let s = Math.abs(v) >= 1e21 ? BigInt(v).toString() : v.toFixed(Math.max(0, Math.min(9, 15 - intDigits)));
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s.replace('.', ',');
};

export function asNumber(v: Value, fnName: string, argIdx: number): number {
  if (typeof v === 'number') return v;
  if (v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${fnName}: arg ${argIdx + 1} is not a number ('${v}')`);
  }
  return n;
}

export function asString(v: Value): string {
  return typeof v === 'string' ? v : String(v);
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * TM1 serial-date epoch: serial 0 = 1960-01-01 (NOT the Unix 1970 epoch). All
 * TM1 date builtins (DATE/DAYNO/TIMVL) count days from here.
 */
export const TM1_EPOCH_MS = Date.UTC(1960, 0, 1);

/** 'yyyy-mm-dd' (or windowed 'yy-mm-dd') → Date. TM1's DATE default form emits a
 *  2-digit year in the 1960-2059 window, so accept both and window 2-digit. */
export function parseYmd(s: string): Date {
  const norm = s.replace(/\//g, '-').trim();
  const m = /^(\d{4}|\d{2})-(\d{1,2})-(\d{1,2})$/.exec(norm);
  if (!m) throw new Error(`invalid date '${s}' — expected YYYY-MM-DD`);
  let y = Number(m[1]);
  if (m[1].length === 2) y = y >= 60 ? 1900 + y : 2000 + y; // TM1 window 1960-2059
  const mo = Number(m[2]) - 1;
  const dd = Number(m[3]);
  return new Date(Date.UTC(y, mo, dd));
}

/** Date → TM1 serial day number (days since 1960-01-01). */
export function dateToTm1Serial(d: Date): number {
  return Math.floor((d.getTime() - TM1_EPOCH_MS) / 86400000);
}

/** TM1 serial day number → Date (UTC midnight of that day). */
export function tm1SerialToDate(serial: number): Date {
  return new Date(TM1_EPOCH_MS + Math.floor(serial) * 86400000);
}

export function expectArity(name: string, args: Value[], min: number, max?: number): void {
  const limit = max ?? min;
  if (args.length < min || args.length > limit) {
    throw new Error(
      `${name}: expected ${min === limit ? `${min}` : `${min}-${limit}`} args, got ${args.length}`,
    );
  }
}

/**
 * Builder for void-returning TI builtins that the simulator does not need
 * to model semantically (schema-mutation, security, transaction, view-config
 * ops). Validates arity, returns 1 for TI compatibility.
 */
export function noopVoid(name: string, min: number, max?: number): Builtin {
  return {
    name,
    invoke: (args) => {
      expectArity(name, args, min, max);
      return 1;
    },
  };
}
