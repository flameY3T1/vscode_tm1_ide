/**
 * String, numeric conversion, scan, file probe, and system built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Section 1b (L124-277): TI's "core" misc functions. Grouped here because
 * they share the same domain (text/value manipulation, with TimSt/INT/RAND
 * the simulator-side numeric utilities).
 */

import {
  type Builtin,
  asNumber,
  asString,
  expectArity,
  numToStr,
} from './_helpers';

export const STRING_MISC_BUILTINS: Builtin[] = [
  {
    name: 'NumberToString',
    invoke: (args) => {
      expectArity('NumberToString', args, 1);
      return numToStr(args[0]);
    },
  },
  {
    // NumberToStringEx(value, format, decimalSep, thousandSep) — formats a number.
    // The `format` decimal mask IS parsed for its decimal-place count: `#,0.###`
    // = up to 3 decimals with trailing zeros dropped (`#` = optional, `0` =
    // required). Without this the raw JS float leaks artifacts (`99526.66` →
    // `99526.660000001`) that diff vs TM1's rounded output. Grouping is applied
    // only when the thousandSep arg is non-empty (the mask's `,` is ignored —
    // TM1 takes the actual separators from args 3/4).
    name: 'NumberToStringEx',
    invoke: (args) => {
      expectArity('NumberToStringEx', args, 4);
      const value = asNumber(args[0], 'NumberToStringEx', 0);
      const fmt = asString(args[1]);
      const decimalSep = asString(args[2]);
      const thousandSep = asString(args[3]);
      if (!Number.isFinite(value)) return '';

      const sign = value < 0 ? '-' : '';
      const abs = Math.abs(value);
      const dotIdx = fmt.indexOf('.');
      let intPart: string;
      let fracPart: string;
      if (dotIdx < 0) {
        // No decimal mask → natural precision (integer masks like `#` keep the
        // number's own fractional digits).
        [intPart, fracPart = ''] = abs.toString().split('.');
      } else {
        // Decimal placeholders after the '.': leading count = max decimals,
        // trailing '#' are optional (dropped when zero), '0' are required.
        const decChars = fmt.slice(dotIdx + 1).match(/^[#0]*/)?.[0] ?? '';
        const maxDec = decChars.length;
        const minDec = decChars.replace(/#+$/, '').length;
        [intPart, fracPart = ''] = abs.toFixed(maxDec).split('.');
        while (fracPart.length > minDec && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
      }

      const grouped = thousandSep
        ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep)
        : intPart;
      return sign + grouped + (fracPart ? (decimalSep || '.') + fracPart : '');
    },
  },
  {
    name: 'StringToNumber',
    invoke: (args) => {
      expectArity('StringToNumber', args, 1);
      return asNumber(args[0], 'StringToNumber', 0);
    },
  },
  {
    // StringToNumberEx(string, decimalSep, thousandSep) — parse with explicit
    // separators (inverse of NumberToStringEx). Non-numeric → 0.
    name: 'StringToNumberEx',
    invoke: (args) => {
      expectArity('StringToNumberEx', args, 3);
      let s = asString(args[0]);
      const dec = asString(args[1]);
      const thou = asString(args[2]);
      if (thou) s = s.split(thou).join('');
      if (dec && dec !== '.') s = s.split(dec).join('.');
      const n = Number(s.trim());
      return Number.isFinite(n) ? n : 0;
    },
  },
  {
    // DELET(string, start, length) — remove `length` chars from `string`
    // starting at 1-based `start`.
    name: 'DELET',
    invoke: (args) => {
      expectArity('DELET', args, 3);
      const s = asString(args[0]);
      const start = Math.trunc(asNumber(args[1], 'DELET', 2));
      const len = Math.trunc(asNumber(args[2], 'DELET', 3));
      if (start < 1 || len <= 0) return s;
      return s.slice(0, start - 1) + s.slice(start - 1 + len);
    },
  },
  {
    // CODE(string, index) — ASCII code of the 1-based char; 0 if out of range.
    name: 'CODE',
    invoke: (args) => {
      expectArity('CODE', args, 2);
      const s = asString(args[0]);
      const idx = Math.trunc(asNumber(args[1], 'CODE', 2));
      if (idx < 1 || idx > s.length) return 0;
      return s.charCodeAt(idx - 1);
    },
  },
  {
    // ROUNDP(value, decimals) — round to `decimals` decimal places.
    name: 'ROUNDP',
    invoke: (args) => {
      expectArity('ROUNDP', args, 2);
      const v = asNumber(args[0], 'ROUNDP', 1);
      const d = Math.trunc(asNumber(args[1], 'ROUNDP', 2));
      const f = Math.pow(10, d);
      return Math.round(v * f) / f;
    },
  },
  {
    // ROUND(value) — TM1's ROUND takes ONE arg and rounds to the nearest integer
    // (live-verified: a 2-arg call aborts). Use ROUNDP for decimal places.
    name: 'ROUND',
    invoke: (args) => {
      expectArity('ROUND', args, 1);
      return Math.round(asNumber(args[0], 'ROUND', 1));
    },
  },
  {
    // Legacy TM1 string→number function (still widely used, e.g. `NUMBR(psYear)-1`).
    // Same semantics as StringToNumber: non-numeric → 0. Without it the enclosing
    // expression fails and the assignment is silently skipped, so a name built from
    // it (`'VD' | NumberToString(NUMBR(psYear)-1) | '…'`) loses its computed prefix.
    name: 'NUMBR',
    invoke: (args) => {
      expectArity('NUMBR', args, 1);
      // TM1 NUMBR is tolerant: non-numeric → 0 (no error). Matching that also
      // keeps the enclosing expression alive instead of aborting the assignment.
      try {
        return asNumber(args[0], 'NUMBR', 0);
      } catch {
        return 0;
      }
    },
  },
  {
    name: 'LONG',
    invoke: (args) => {
      expectArity('LONG', args, 1);
      return asString(args[0]).length;
    },
  },
  {
    name: 'Char',
    invoke: (args) => {
      expectArity('Char', args, 1);
      const code = Math.floor(asNumber(args[0], 'Char', 0));
      // TM1 Char() accepts 0..255 (Latin-1 codepoint). Negative or NaN → empty.
      if (!Number.isFinite(code) || code < 0 || code > 255) return '';
      return String.fromCharCode(code);
    },
  },
  {
    name: 'SUBST',
    invoke: (args) => {
      expectArity('SUBST', args, 3);
      const s = asString(args[0]);
      const start = Math.max(1, Math.floor(asNumber(args[1], 'SUBST', 1))) - 1;
      const len = Math.max(0, Math.floor(asNumber(args[2], 'SUBST', 2)));
      return s.substring(start, start + len);
    },
  },
  {
    name: 'UPPER',
    invoke: (args) => {
      expectArity('UPPER', args, 1);
      return asString(args[0]).toUpperCase();
    },
  },
  {
    // LTRIM(s) — remove leading whitespace.
    name: 'LTRIM',
    invoke: (args) => {
      expectArity('LTRIM', args, 1);
      return asString(args[0]).replace(/^\s+/, '');
    },
  },
  {
    // RTRIM(s) — remove trailing whitespace.
    name: 'RTRIM',
    invoke: (args) => {
      expectArity('RTRIM', args, 1);
      return asString(args[0]).replace(/\s+$/, '');
    },
  },
  {
    // INSRT(insert, string, position) — insert `insert` into `string` before the
    // 1-based `position`. pos<=1 prepends; pos>len appends.
    name: 'INSRT',
    invoke: (args) => {
      expectArity('INSRT', args, 3);
      const ins = asString(args[0]);
      const s = asString(args[1]);
      const pos = Math.trunc(asNumber(args[2], 'INSRT', 2));
      const at = Math.min(Math.max(pos - 1, 0), s.length);
      return s.slice(0, at) + ins + s.slice(at);
    },
  },
  {
    // CODEW(string, location) — Unicode code point of the 1-based char; 0 if out
    // of range. Wide/Unicode counterpart of CODE (which returns an 8-bit code).
    name: 'CODEW',
    invoke: (args) => {
      expectArity('CODEW', args, 2);
      const s = asString(args[0]);
      const idx = Math.trunc(asNumber(args[1], 'CODEW', 2));
      if (idx < 1 || idx > s.length) return 0;
      return s.codePointAt(idx - 1) ?? 0;
    },
  },
  {
    // VALUE(string) — parse a string to a number; non-numeric → 0 (tolerant,
    // like NUMBR). TM1 legacy alias used in numeric coercion.
    name: 'VALUE',
    invoke: (args) => {
      expectArity('VALUE', args, 1);
      try {
        return asNumber(args[0], 'VALUE', 0);
      } catch {
        return 0;
      }
    },
  },
  {
    // CAPIT(s) — initial-capitalise every whitespace-delimited word; other
    // letters pass through unchanged (IBM PA docs).
    name: 'CAPIT',
    invoke: (args) => {
      expectArity('CAPIT', args, 1);
      return asString(args[0]).replace(/(^|\s)(\S)/g, (_m, sep, ch) => sep + ch.toUpperCase());
    },
  },
  {
    // STR(number, length, decimals) — fixed-format float → string (IBM PA):
    //  • decimal separator is always '.', no thousands grouping;
    //  • right-justified with leading spaces to `length`;
    //  • length<=0 → ''; whole-part digits exceeding length by MORE than 5 → '';
    //  • overflow with decimals=0 truncates the whole part to `length` digits,
    //    with decimals>0 the full whole part is preserved;
    //  • rounds to `decimals` places. NB: NOT locale — unlike NumberToString.
    name: 'STR',
    invoke: (args) => {
      expectArity('STR', args, 3);
      const num = asNumber(args[0], 'STR', 0);
      const length = Math.trunc(asNumber(args[1], 'STR', 1));
      const decimals = Math.max(0, Math.trunc(asNumber(args[2], 'STR', 2)));
      if (length <= 0) return '';
      const rounded = Number(num.toFixed(decimals));
      const wholeStr = Math.floor(Math.abs(rounded)).toString();
      let body: string;
      if (wholeStr.length > length) {
        if (wholeStr.length > length + 5) return '';
        if (decimals === 0) {
          // Sign counts toward the width: truncate the SIGNED string so the
          // whole result (sign included) fits `length` chars. Exact digit
          // truncation of negatives is best-effort pending live verification.
          body = ((rounded < 0 ? '-' : '') + wholeStr).slice(0, length);
        } else {
          body = rounded.toFixed(decimals);
        }
      } else {
        body = rounded.toFixed(decimals);
      }
      return body.length < length ? ' '.repeat(length - body.length) + body : body;
    },
  },
  {
    name: 'LOWER',
    invoke: (args) => {
      expectArity('LOWER', args, 1);
      return asString(args[0]).toLowerCase();
    },
  },
  {
    name: 'TRIM',
    invoke: (args) => {
      expectArity('TRIM', args, 1);
      return asString(args[0]).trim();
    },
  },
  {
    // Scan(needle, haystack) → 1-based position of needle, 0 if absent or
    // needle is empty. Bedrock idiom: `Scan('.', sFile)` finds extension.
    name: 'Scan',
    invoke: (args) => {
      expectArity('Scan', args, 2);
      const needle = asString(args[0]);
      const hay = asString(args[1]);
      if (needle === '') return 0;
      const idx = hay.indexOf(needle);
      return idx < 0 ? 0 : idx + 1;
    },
  },
  {
    // FileExists(path) — simulator has no filesystem context, so any path is
    // assumed to exist. Lets bedrock `If(FileExists(p)=0)` guards pass through.
    name: 'FileExists',
    invoke: (args) => {
      expectArity('FileExists', args, 1);
      return 1;
    },
  },
  {
    name: 'GetProcessErrorFileDirectory',
    invoke: () => '',
  },
  {
    name: 'GetProcessName',
    invoke: (_args, fixtures) => fixtures?.processName ?? '',
  },
  {
    name: 'TM1User',
    invoke: () => '',
  },
  {
    // INT(x) — TM1 truncates toward zero (not floor). `INT(-3.7) === -3`.
    name: 'INT',
    invoke: (args) => {
      expectArity('INT', args, 1);
      return Math.trunc(asNumber(args[0], 'INT', 0));
    },
  },
  {
    name: 'RAND',
    invoke: () => Math.random(),
  },
  {
    // TimSt(serial, format) — simulator ignores the serial arg and formats
    // current time. Sufficient to materialise bedrock timestamps without
    // breaking call sites; exact value irrelevant for diff parity.
    name: 'TimSt',
    invoke: (args, fixtures) => {
      expectArity('TimSt', args, 2);
      const fmt = asString(args[1]);
      const d = fixtures?.now ?? new Date();
      const Y = String(d.getUTCFullYear());
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const h = String(d.getUTCHours()).padStart(2, '0');
      const min = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      return (
        fmt
          .replace(/\\Y/g, Y)
          .replace(/\\m/g, m)
          .replace(/\\d/g, day)
          .replace(/\\h/g, h)
          .replace(/\\i/g, min)
          .replace(/\\s/g, s)
          // TM1 drops a dangling/unknown backslash escape (e.g. the trailing `\`
          // in `'\Y\m\d\'`); emitting it literally corrupts paths built from the
          // timestamp (`…20260712\.txt`). Turn any remaining `\X` into X, `\` → ''.
          .replace(/\\(.?)/g, '$1')
      );
    },
  },
];
