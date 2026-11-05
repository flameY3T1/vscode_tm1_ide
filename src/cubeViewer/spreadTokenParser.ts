import type { SpreadMethod } from './spreadMethods';

export interface ParsedSpread {
  method: SpreadMethod;
  value: number;
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** Parses TM1-Architect-style spread tokens into a structured {method, value}.
 *
 *  Supported:
 *    ~~       → clear
 *    ~N       → proportional
 *    %N       → percentage
 *    !N       → repeat
 *
 *  NOT supported (return null): /N (Equal — not in v1.8.0), +N, *N
 *  (Architect client-side conversions with no TM1 REST equivalent). */
export function parseSpreadToken(raw: string): ParsedSpread | null {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  if (s === '~~') return { method: 'clear', value: 0 };

  const prefix = s[0];
  const rest = s.slice(1);
  if (rest === '' || !NUMBER_RE.test(rest)) return null;
  const value = Number(rest);

  switch (prefix) {
    case '~': return { method: 'proportional', value };
    case '%': return { method: 'percentage',   value };
    case '!': return { method: 'repeat',       value };
    default:  return null;
  }
}
