import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseStatements } from '../../../tiSimulator/ast/parseStatement';
import { evalStatement } from '../../../tiSimulator/eval/evalStatement';
import { Scope } from '../../../tiSimulator/eval/scope';
import { OutputCollector } from '../../../tiSimulator/output/outputCollector';
import { emptyFixtures, type SimWarning } from '../../../tiSimulator/types';

// Formatters 0..7, created in this order before every case.
const FORMATTERS = [
  "a = NewDateFormatter('', 'Europe/Berlin', 'serial', 'full', 'datetime');",
  "u = NewDateFormatter('', 'etc/UTC', 'serial', 'full', 'datetime');",
  "n = NewDateFormatter('', 'America/New_York', 'unix', 'short', 'datetime');",
  "k = NewDateFormatter('', 'UTC', 'serial', 'medium', 'date');",
  "t = NewDateFormatter('', 'Asia/Kolkata', 'serial', 'long', 'time');",
  "l = NewDateFormatter('', 'Australia/Sydney', 'serial', 'long', 'datetime');",
  "x = NewDateFormatter('', 'Nowhere/Bogus', 'serial', 'full', 'datetime');",
  "m = NewDateFormatter('', 'Etc/UTC', 'serial', 'medium', '');",
].join('\r\n');

// [statements that set sR, result on TM1 11.8 AND v12]. Measured 2026-10-19 via
// transient processes; both versions answered byte-identically. '' in the last
// rows = a failed ParseDate, which the simulator reports as a warning.
const MEASURED: ReadonlyArray<readonly [string, string]> = [
  ["sR = NumberToString(a);", "0"],
  ["sR = NumberToString(n);", "2"],
  ["sR = NumberToString(x);", "6"],
  ["sR = FormatDate(23345.5, '', a);", "Friday, December 1, 2023 at 1:00:00 PM Central European Standard Time"],
  ["sR = FormatDate(23345.5, '', u);", "Friday, December 1, 2023 at 12:00:00 PM GMT"],
  ["sR = FormatDate(1701432000000, '', n);", "12/1/23, 7:00 AM"],
  ["sR = FormatDate(23345.5, '', k);", "Dec 1, 2023"],
  ["sR = FormatDate(23345.5, '', t);", "5:30:00 PM GMT+5:30"],
  ["sR = FormatDate(23345.5, '', l);", "December 1, 2023 at 11:00:00 PM GMT+11"],
  ["sR = FormatDate(23345.5, '', x);", "Friday, December 1, 2023 at 12:00:00 PM GMT"],
  ["sR = FormatDate(23345.5, '', m);", "Dec 1, 2023"],
  ["sR = FormatDate(23192.25, '', a);", "Saturday, July 1, 2023 at 8:00:00 AM Central European Summer Time"],
  ["sR = FormatDate(23192.25, '', u);", "Saturday, July 1, 2023 at 6:00:00 AM GMT"],
  ["sR = FormatDate(23192.25, '', k);", "Jul 1, 2023"],
  ["sR = FormatDate(23192.25, '', l);", "July 1, 2023 at 4:00:00 PM GMT+10"],
  ["sR = FormatDate(23192.25, '', x);", "Saturday, July 1, 2023 at 6:00:00 AM GMT"],
  ["sR = FormatDate(23192.75, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', a);", "2023-07-01 20:00:00.000 GMT+2 Central European Summer Time +0200 +02 +02:00 Europe/Berlin"],
  ["sR = FormatDate(23192.75, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', u);", "2023-07-01 18:00:00.000 GMT GMT +0000 Z Z Etc/Unknown"],
  ["sR = FormatDate(1688212800000, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', n);", "2023-07-01 08:00:00.000 EDT Eastern Daylight Time -0400 -04 -04:00 America/New_York"],
  ["sR = FormatDate(23192.75, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', k);", "2023-07-01 18:00:00.000 UTC Coordinated Universal Time +0000 Z Z UTC"],
  ["sR = FormatDate(23192.75, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', t);", "2023-07-01 23:30:00.000 GMT+5:30 India Standard Time +0530 +0530 +05:30 Asia/Kolkata"],
  ["sR = FormatDate(23192.75, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', l);", "2023-07-02 04:00:00.000 GMT+10 Australian Eastern Standard Time +1000 +10 +10:00 Australia/Sydney"],
  ["sR = FormatDate(23192.75, 'yyyy-MM-dd HH:mm:ss.SSS z zzzz Z X XXX VV', x);", "2023-07-01 18:00:00.000 GMT GMT +0000 Z Z Etc/Unknown"],
  ["sR = FormatDate(23345.5, 'G y yy yyyy M MM MMM MMMM d dd E EEE EEEE e ee eee eeee H HH h hh a m mm s ss S SS SSS D DD DDD w ww Q QQ');", "AD 2023 23 2023 12 12 Dec December 1 01 Fri Fri Friday 6 06 Fri Friday 13 13 1 01 PM 0 00 0 00 0 00 000 335 335 335 48 48 4 04"],
  ["sR = FormatDate(23345.5, 'yyyy-MM-dd');", "2023-12-01"],
  ["sR = FormatDate(23345.5, 'h:mm a');", "1:00 PM"],
  ["sR = FormatDate(0, 'yyyy-MM-dd HH:mm:ss');", "1960-01-01 01:00:00"],
  ["sR = FormatDate(-36524.25, 'yyyy-MM-dd HH:mm G');", "1859-12-31 18:53 AD"],
  ["sR = FormatDate(25000.123, 'yyyy-MM-dd HH:mm:ss.SSS D w e');", "2028-06-12 04:57:07.200 164 25 2"],
  ["sR = FormatDate(23345.5, 'yyyy-MM-dd', 5);", "2023-12-01"],
  ["sR = FormatDate(23345.5, '', 5);", "December 1, 2023 at 11:00:00 PM GMT+11"],
  ["sR = FormatDate(23345.5, '');", "Friday, December 1, 2023 at 1:00:00 PM Central European Standard Time"],
  ["sR = FormatDate(22646.5, 'D w eeee', u);", "1 1 Saturday"],
  ["sR = FormatDate(23376.5, 'D w eeee yyyy', u);", "1 1 Monday 2024"],
  ["sR = FormatDate(23741.5, 'D w eeee yyyy', u);", "366 1 Tuesday 2024"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00', 'yyyy-MM-dd HH:mm:ss', a));", "23345,458333333"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00', 'yyyy-MM-dd HH:mm:ss', u));", "23345,5"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00', 'yyyy-MM-dd HH:mm:ss', n));", "1701450000000"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00', 'yyyy-MM-dd HH:mm:ss', 9));", "23345,5"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00', 'yyyy-MM-dd HH:mm:ss'));", "23345,458333333"],
  ["sR = NumberToString(ParseDate('2023-12-01'));", ""],
  ["sR = NumberToString(ParseDate('2023-12-01', 'yyyy-MM-dd', 9));", "23345"],
  ["sR = NumberToString(ParseDate('2023-12-01 06:30:00', '', 9));", "23345"],
  ["sR = NumberToString(ParseDate('2023-7-1 5:3:2', 'yyyy-MM-dd HH:mm:ss', 9));", "23192,210439815"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00 x', 'yyyy-MM-dd HH:mm:ss', 9));", "23345,5"],
  ["sR = NumberToString(ParseDate('23-12-01', 'yy-MM-dd', 9));", "23345"],
  ["sR = NumberToString(ParseDate('99-12-01', 'yy-MM-dd', 9));", "14579"],
  ["sR = NumberToString(ParseDate('46-12-01', 'yy-MM-dd', 9));", "-4779"],
  ["sR = NumberToString(ParseDate('45-12-01', 'yy-MM-dd', 9));", "31381"],
  ["sR = NumberToString(ParseDate('Fri Dec 01 2023', 'eee MMM dd yyyy', 9));", "23345"],
  ["sR = NumberToString(ParseDate('Friday December 1 2023', 'EEEE MMMM d yyyy', 9));", "23345"],
  ["sR = NumberToString(ParseDate('dec 1 2023', 'MMM d yyyy', 9));", "23345"],
  ["sR = NumberToString(ParseDate('2023-12-01 1:00 PM', 'yyyy-MM-dd h:mm a', 9));", "23345,541666667"],
  ["sR = NumberToString(ParseDate('2023-12-01T12:00:00+02:00', 'yyyy-MM-dd''T''HH:mm:ssXXX', a));", "23345,416666667"],
  ["sR = NumberToString(ParseDate('2023-12-01T12:00:00Z', 'yyyy-MM-dd''T''HH:mm:ssX', a));", "23345,5"],
  ["sR = NumberToString(ParseDate('20231201', 'yyyyMMdd', 9));", "23345"],
  ["sR = NumberToString(ParseDate('2023-12-01 12:00:00.250', 'yyyy-MM-dd HH:mm:ss.SSS', 9));", "23345,500002894"],
  ["sR = NumberToString(ParseDate(FormatDate(23345.5, '', a), '', a));", "23345,5"],
  ["sR = NumberToString(ParseDate(FormatDate(23192.25, '', l), '', l));", "23192,25"],
  ["sR = NumberToString(ParseDate(FormatDate(23345.5, '', k), '', k));", "23345"],
  ["sR = NumberToString(ParseDate(FormatDate(23345.25, '', t), '', t));", "3653,25"],
  ["sR = NumberToString(ParseDate(FormatDate(23345.25, '', x), '', x));", "23345,25"],
  ["sR = NumberToString(ParseDate(FormatDate(23345.5, '', m), '', m));", "23345"],
  ["nX = ParseDate('garbage', 'yyyy-MM-dd', 9);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('2023-02-30', 'yyyy-MM-dd', 9);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('2023-12-01 13:00', 'yyyy-MM-dd hh:mm', 9);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('2023-12-01', 'yyyy-MM-dd HH:mm:ss', 9);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('12/01/2023', 'yyyy-MM-dd', 9);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('Dec 1, 2023, 12:00:00 PM', '', a);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('2023-13-01', 'yyyy-MM-dd', 9);\r\nsR = NumberToString(nX + 0);", ""],
  ["nX = ParseDate('2023-12-01 24:00', 'yyyy-MM-dd HH:mm', 9);\r\nsR = NumberToString(nX + 0);", ""],
];

// Two-digit years fall in a window that starts 80 years before now, to the day,
// so the 'yy' and short-style rows hold only around their measuring date; pin the clock.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

function run(tail: string): { value: string | number | undefined; warnings: SimWarning[] } {
  const scope = new Scope();
  const warnings: SimWarning[] = [];
  const fixtures = emptyFixtures();
  for (const st of parseStatements(`${FORMATTERS}\r\n${tail}`).statements) {
    evalStatement(st, { scope, output: new OutputCollector(), warnings, section: 'prolog', fixtures });
  }
  return { value: scope.get('sR'), warnings };
}

describe('NewDateFormatter / FormatDate / ParseDate match TM1', () => {
  it.each(MEASURED)('%s', (tail, want) => {
    const { value, warnings } = run(tail);
    if (want === '') {
      expect(warnings.map((w) => w.message).join()).toMatch(/does not match/);
      return;
    }
    const got = typeof value === 'number' ? value : String(value);
    if (typeof got === 'number') expect(got).toBeCloseTo(Number(want.replace(',', '.')), 6);
    else expect(got).toBe(want);
  });
});

describe('ParseDate two-digit years (measured 2026-10-21, 11.8 + v12)', () => {
  // Formatter 8, the one the review measured.
  const SHORT = "s = NewDateFormatter('', 'Etc/UTC', 'unix', 'short', 'date');\r\n";
  it.each([
    ["sR = FormatDate(0, '', s);", '1/1/70'],
    ["sR = NumberToString(ParseDate('1/1/70', '', s));", '0'],
    ["sR = NumberToString(ParseDate('1/1/45', '', s));", '2366841600000'],
    ["sR = NumberToString(ParseDate('1/1/46', '', s));", '2398377600000'],
    ["sR = NumberToString(ParseDate('12/1/23', '', s));", '1701388800000'],
  ])('%s', (tail, want) => {
    expect(String(run(SHORT + tail).value)).toBe(want);
  });
});
