/**
 * Date / calendar built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Section 3 (L449-510) of the source.
 */

import {
  type Builtin,
  asNumber,
  asString,
  expectArity,
  formatYmd,
  pad2,
  parseYmd,
  dateToTm1Serial,
  tm1SerialToDate,
  TM1_EPOCH_MS,
} from './_helpers';

export const DATE_BUILTINS: Builtin[] = [
  {
    name: 'Today',
    invoke: (args, fixtures) => {
      // Both Today() and Today(1) return formatted string here.
      // (TM1's numeric serial form is rarely relied on in tested processes.)
      void args;
      return formatYmd(fixtures?.now ?? new Date());
    },
  },
  {
    // Full TM1 serial (days since 1960-01-01 plus the day fraction), not just
    // the fraction: measured 24398.86 on v12, 2026-10-19.
    name: 'Now',
    invoke: (_args, fixtures) => ((fixtures?.now ?? new Date()).getTime() - TM1_EPOCH_MS) / 86400000,
  },
  {
    name: 'DAY',
    invoke: (args) => {
      expectArity('DAY', args, 1);
      return parseYmd(asString(args[0])).getUTCDate();
    },
  },
  {
    name: 'MONTH',
    invoke: (args) => {
      expectArity('MONTH', args, 1);
      return parseYmd(asString(args[0])).getUTCMonth() + 1;
    },
  },
  {
    name: 'YEAR',
    invoke: (args) => {
      expectArity('YEAR', args, 1);
      return parseYmd(asString(args[0])).getUTCFullYear();
    },
  },
  {
    // DAYNO(date) — TM1 serial day number (days since 1960-01-01, the TM1 epoch).
    name: 'DAYNO',
    invoke: (args) => {
      expectArity('DAYNO', args, 1);
      return dateToTm1Serial(parseYmd(asString(args[0])));
    },
  },
  {
    // DATE(serial, [fourDigitYear]) — inverse of DAYNO. serial 0 = 1960-01-01.
    // Default (flag 0/omitted) emits a 2-digit year (window 1960-2059); flag ≠ 0
    // emits a 4-digit year. Quirk: in 2-digit mode a serial past the 2059 window
    // (> 36524) wraps by subtracting 36525 (matches TM1).
    name: 'DATE',
    invoke: (args) => {
      expectArity('DATE', args, 1, 2);
      let n = Math.trunc(asNumber(args[0], 'DATE', 0));
      const four = args.length > 1 && asNumber(args[1], 'DATE', 1) !== 0;
      if (!four && n > 36524) n = n - 36525;
      const d = tm1SerialToDate(n);
      const body = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      return four ? `${d.getUTCFullYear()}-${body}` : `${pad2(d.getUTCFullYear() % 100)}-${body}`;
    },
  },
  {
    // TIMVL(datetime, type, [extendedYears]) — numeric value of one date/time
    // component. `type` is a CHARACTER code (NOT a numeric index): Y year,
    // M month (1-12), D day (1-31), H hour (0-23), I MINUTE (0-59, note 'I' not
    // 'M'), S second (0-59). Integer part of the serial = date (1960 epoch),
    // fractional part = time within the day.
    name: 'TIMVL',
    invoke: (args) => {
      expectArity('TIMVL', args, 2, 3);
      const ser = asNumber(args[0], 'TIMVL', 0);
      const t = asString(args[1]).toUpperCase();
      const frac = ser - Math.floor(ser);
      const d = tm1SerialToDate(ser);
      switch (t) {
        case 'Y': return d.getUTCFullYear();
        case 'M': return d.getUTCMonth() + 1;
        case 'D': return d.getUTCDate();
        case 'H': return Math.floor(frac * 24);
        case 'I': return Math.floor(frac * 1440) % 60;
        case 'S': return Math.floor(frac * 86400) % 60;
        default: throw new Error(`TIMVL: unknown component '${t}' (expected Y/M/D/H/I/S)`);
      }
    },
  },
  {
    // DATES(year, month, day) — build a 'yyyy-mm-dd' string from components.
    // Overflowing month/day normalise via JS Date (e.g. month 13 → next year).
    name: 'DATES',
    invoke: (args) => {
      expectArity('DATES', args, 3);
      const y = Math.trunc(asNumber(args[0], 'DATES', 0));
      const m = Math.trunc(asNumber(args[1], 'DATES', 1));
      const d = Math.trunc(asNumber(args[2], 'DATES', 2));
      return formatYmd(new Date(Date.UTC(y, m - 1, d)));
    },
  },
  {
    name: 'AddMonths',
    invoke: (args) => {
      expectArity('AddMonths', args, 2);
      const d = parseYmd(asString(args[0]));
      const shift = Math.trunc(asNumber(args[1], 'AddMonths', 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + shift;
      const day = d.getUTCDate();
      const targetY = y + Math.floor(m / 12);
      const targetM = ((m % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
      const clampedDay = Math.min(day, lastDay);
      return formatYmd(new Date(Date.UTC(targetY, targetM, clampedDay)));
    },
  },
];
