/**
 * NewDateFormatter / FormatDate / ParseDate — ICU date formatting.
 *
 * Measured on TM1 11.8 and v12 through transient processes (2026-10-19); both
 * versions answered byte-identically. Server behaviour this module copies:
 *  - NewDateFormatter appends to a per-process list and returns its index
 *    (0, 1, 2, …). FormatDate/ParseDate without an index use index 0; an index
 *    with no formatter behind it falls back to the default (UTC, serial).
 *  - A non-empty pattern always wins over the formatter's style; the formatter
 *    then only contributes its time zone and unit. An empty pattern prints the
 *    style (en-US full/long/medium/short × date/time/datetime). Without any
 *    formatter, '' means 'yyyy-MM-dd HH:mm:ss'.
 *  - Time zone IDs are case-sensitive: 'etc/UTC' is NOT a zone, ICU falls back
 *    to GMT silently (that is what Bedrock passes).
 *  - 'serial' = TM1 day number (1960 epoch, UTC); 'unix' = epoch MILLIseconds.
 *  - A failed parse makes the statement fail ("Invalid real number 'nullptr'").
 *
 * Not modelled: a non-empty locale (measured output was undecodable), and the
 * TI quirk that a nested call's string argument can overwrite the outer
 * call's pattern (`FormatDate(x, 'p', NewDateFormatter('de-DE'))` formats
 * with 'de-DE'). Processes assign the formatter to a variable first.
 */

import type { DateFormatter, Fixtures, Value } from '../../types';
import { type Builtin, TM1_EPOCH_MS, asNumber, asString, expectArity } from './_helpers';

const DEFAULT: DateFormatter = { zone: 'Etc/UTC', unix: false, style: 'medium', type: 'datetime' };
const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function resolveZone(id: string): string | null {
  if (id === '') return 'Etc/UTC';
  // ICU zone IDs are case-sensitive, Intl accepts any casing ('etc/UTC').
  // ponytail: casing checked as "every segment starts upper-case", which holds
  // for IANA names; a full case-exact list (with links) only if this misfires.
  if (!id.split('/').every((seg) => /^[A-Z]/.test(seg))) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return id;
  } catch {
    return null;
  }
}

// ── Zone arithmetic ──────────────────────────────────────────────────────

type Fields = { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number; dow: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fields(ms: number, zone: string | null): Fields {
  const tz = zone ?? 'UTC';
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', era: 'short',
    });
    partsCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  const y = Number(p.year) * (p.era === 'BC' ? -1 : 1) + (p.era === 'BC' ? 1 : 0);
  return {
    y, mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second),
    ms: ((ms % 1000) + 1000) % 1000, dow: DAYS.findIndex((n) => n.startsWith(p.weekday)),
  };
}

function utcOf(f: Omit<Fields, 'dow'>): number {
  const t = Date.UTC(2000, f.mo - 1, f.d, f.h, f.mi, f.s, f.ms);
  const d = new Date(t);
  d.setUTCFullYear(f.y);
  return d.getTime();
}

/** Zone offset at `ms`: wall clock read as UTC minus the instant. */
function offsetMs(ms: number, zone: string | null): number {
  return utcOf(fields(ms, zone)) - ms;
}

/** Wall-clock fields in `zone` → instant (two passes cover DST edges). */
function instantOf(f: Omit<Fields, 'dow'>, zone: string | null): number {
  const local = utcOf(f);
  let t = local - offsetMs(local, zone);
  t = local - offsetMs(t, zone);
  return t;
}

function zoneName(ms: number, zone: string | null, long: boolean): string {
  if (zone === null) return 'GMT';
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: long ? 'long' : 'short' }).formatToParts(ms);
  return p.find((x) => x.type === 'timeZoneName')!.value;
}

// ── Pattern format / parse ───────────────────────────────────────────────

type Token = { lit: string } | { ch: string; n: number };

function tokenize(pattern: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < pattern.length;) {
    const c = pattern[i];
    if (c === "'") {
      if (pattern[i + 1] === "'") { out.push({ lit: "'" }); i += 2; continue; }
      const end = pattern.indexOf("'", i + 1);
      out.push({ lit: pattern.slice(i + 1, end < 0 ? undefined : end).replace(/''/g, "'") });
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let n = 1;
      while (pattern[i + n] === c) n++;
      out.push({ ch: c, n });
      i += n;
      continue;
    }
    out.push({ lit: c });
    i++;
  }
  return out;
}

const pad = (v: number, n: number) => String(Math.abs(v)).padStart(n, '0');

function offsetText(offMin: number, colon: boolean, zForZero: boolean): string {
  if (offMin === 0 && zForZero) return 'Z';
  const sign = offMin < 0 ? '-' : '+';
  const a = Math.abs(offMin);
  return `${sign}${pad(Math.floor(a / 60), 2)}${colon ? ':' : ''}${pad(a % 60, 2)}`;
}

function formatPattern(ms: number, pattern: string, zone: string | null): string {
  const f = fields(ms, zone);
  const offMin = Math.round(offsetMs(ms, zone) / 60000);
  const midnight = { h: 0, mi: 0, s: 0, ms: 0 };
  const doy = Math.round((utcOf({ ...f, ...midnight }) - utcOf({ y: f.y, mo: 1, d: 1, ...midnight })) / DAY_MS) + 1;
  let out = '';
  for (const t of tokenize(pattern)) {
    if ('lit' in t) { out += t.lit; continue; }
    const { ch, n } = t;
    switch (ch) {
      case 'G': out += f.y > 0 ? 'AD' : 'BC'; break;
      case 'y': out += n === 2 ? pad(f.y % 100, 2) : pad(f.y, n); break;
      case 'M': case 'L': out += n >= 4 ? MONTHS[f.mo - 1] : n === 3 ? MONTHS[f.mo - 1].slice(0, 3) : pad(f.mo, n); break;
      case 'd': out += pad(f.d, n); break;
      case 'E': out += n >= 4 ? DAYS[f.dow] : DAYS[f.dow].slice(0, 3); break;
      case 'e': case 'c': out += n >= 4 ? DAYS[f.dow] : n === 3 ? DAYS[f.dow].slice(0, 3) : pad(f.dow + 1, n); break;
      case 'H': out += pad(f.h, n); break;
      case 'h': out += pad(f.h % 12 || 12, n); break;
      case 'a': out += f.h < 12 ? 'AM' : 'PM'; break;
      case 'm': out += pad(f.mi, n); break;
      case 's': out += pad(f.s, n); break;
      case 'S': out += pad(f.ms, 3).padEnd(n, '0').slice(0, n); break;
      case 'D': out += pad(doy, n); break;
      case 'w': {
        // en-US weeks: start Sunday, week 1 holds Jan 1 — so the last days of
        // December can already be week 1 (2024-12-31 → 1, measured).
        const zero = { h: 0, mi: 0, s: 0, ms: 0 };
        const weekStart = utcOf({ ...f, ...zero }) - f.dow * DAY_MS;
        const nextJan1 = utcOf({ y: f.y + 1, mo: 1, d: 1, ...zero });
        const jan1 = new Date(utcOf({ y: f.y, mo: 1, d: 1, ...zero })).getUTCDay();
        out += pad(nextJan1 - weekStart < 7 * DAY_MS ? 1 : Math.floor((doy - 1 + jan1) / 7) + 1, n);
        break;
      }
      case 'Q': out += pad(Math.ceil(f.mo / 3), n); break;
      case 'z': out += zoneName(ms, zone, n >= 4); break;
      case 'Z': out += offsetText(offMin, false, false); break;
      case 'X':
        // X drops zero minutes (+02, +0530); XX = +0200; XXX = +02:00 (measured).
        out += n >= 3 ? offsetText(offMin, true, true)
          : n === 1 && offMin % 60 === 0 ? offsetText(offMin, false, true).slice(0, 3)
          : offsetText(offMin, false, true);
        break;
      case 'V': out += zone ?? 'Etc/Unknown'; break;
      default: throw new Error(`FormatDate: pattern letter '${ch}' is not simulated`);
    }
  }
  return out;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

class ParseFailed extends Error {}

function parsePattern(text: string, pattern: string, zone: string | null): number {
  const f = { y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 0, ms: 0 };
  let pm: boolean | undefined;
  let h12: number | undefined;
  let offMin: number | undefined;
  let yy: number | undefined;
  let i = 0;
  const toks = tokenize(pattern);
  const fail = (): never => { throw new ParseFailed(); };
  const num = (n: number, fixed: boolean): number => {
    const m = (fixed ? new RegExp(`^\\d{${n}}`) : /^\d+/).exec(text.slice(i));
    if (!m) fail();
    i += m![0].length;
    return Number(m![0]);
  };
  const word = (list: string[]): number => {
    const rest = text.slice(i).toLowerCase();
    const k = list.findIndex((w) => rest.startsWith(w.toLowerCase()));
    if (k < 0) fail();
    i += list[k].length;
    return k;
  };
  toks.forEach((t, k) => {
    if ('lit' in t) { if (!text.startsWith(t.lit, i)) fail(); i += t.lit.length; return; }
    // Adjacent numeric fields need fixed widths to split; otherwise digits run free.
    const next = toks[k + 1];
    const fixed = next !== undefined && !('lit' in next);
    switch (t.ch) {
      case 'y': {
        const start = i;
        const v = num(t.n, fixed);
        // Two digits: the century window starts 80 years back (2026: 1946–2045, measured).
        if (t.n === 2 && i - start === 2) yy = v; else f.y = v;
        break;
      }
      case 'M': case 'L':
        if (t.n >= 3) { const longIdx = (() => { const at = i; try { return word(MONTHS); } catch { i = at; return -1; } })(); f.mo = (longIdx >= 0 ? longIdx : word(MONTHS.map((m) => m.slice(0, 3)))) + 1; }
        else f.mo = num(t.n, fixed);
        break;
      case 'd': f.d = num(t.n, fixed); break;
      case 'E': case 'e': case 'c':
        if (t.n >= 3 || t.ch === 'E') { const at = i; try { word(DAYS); } catch { i = at; word(DAYS.map((d) => d.slice(0, 3))); } }
        else num(t.n, fixed);
        break;
      case 'H': f.h = num(t.n, fixed); if (f.h > 23) fail(); break;
      case 'h': h12 = num(t.n, fixed); if (h12 < 1 || h12 > 12) fail(); break;
      case 'a': pm = word(['AM', 'PM']) === 1; break;
      case 'm': f.mi = num(t.n, fixed); if (f.mi > 59) fail(); break;
      case 's': f.s = num(t.n, fixed); if (f.s > 59) fail(); break;
      case 'S': { const start = i; const v = num(t.n, fixed); f.ms = Math.round(v * 10 ** (3 - (i - start))); break; }
      case 'X': case 'Z': {
        if (text[i] === 'Z') { i++; offMin = 0; break; }
        const m = /^([+-])(\d{2}):?(\d{2})?/.exec(text.slice(i));
        if (!m) fail();
        i += m![0].length;
        offMin = (m![1] === '-' ? -1 : 1) * (Number(m![2]) * 60 + Number(m![3] ?? 0));
        break;
      }
      default: throw new Error(`ParseDate: pattern letter '${t.ch}' is not simulated`);
    }
  });
  if (h12 !== undefined) f.h = (h12 % 12) + (pm ? 12 : 0);
  else if (pm && f.h < 12) f.h += 12;
  if (yy !== undefined) f.y = windowYear(f, yy);
  if (f.mo < 1 || f.mo > 12 || f.d < 1 || f.d > daysIn(f.y, f.mo)) fail();
  return offMin === undefined ? instantOf(f, zone) : utcOf(f) - offMin * 60000;
}

/**
 * Two-digit year: the century window starts 80 years before now, to the day,
 * for the 'yy' pattern and the short style alike. Measured 2026-10-21 on 11.8
 * and v12: '1/1/46' = 2046, '46-12-01' = 1946, '1/1/70' = 1970, '1/1/45' = 2045.
 */
function windowYear(f: { mo: number; d: number; h: number; mi: number; s: number }, yy: number): number {
  const now = new Date();
  const from = now.getUTCFullYear() - 80;
  const y = from - (from % 100) + yy;
  const start = Date.UTC(from, now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
  return Date.UTC(y, f.mo - 1, f.d, f.h, f.mi, f.s) < start ? y + 100 : y;
}

// ── Style format / parse ─────────────────────────────────────────────────

function formatStyle(ms: number, fmt: DateFormatter): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: fmt.zone ?? 'UTC' };
  if (fmt.type !== 'time') opts.dateStyle = fmt.style;
  if (fmt.type !== 'date') opts.timeStyle = fmt.style;
  let s = new Intl.DateTimeFormat('en-US', opts).format(ms).replace(/[\u202f\u00a0]/g, ' ');
  // Unknown zone: ICU prints the UTC wall clock with "GMT" as the zone name.
  if (fmt.zone === null && fmt.type !== 'date' && (fmt.style === 'full' || fmt.style === 'long')) {
    s = s.replace(/ (Coordinated Universal Time|UTC)$/, ' GMT');
  }
  return s;
}

/** Read the en-US style back: pick the fields out, rebuild, and accept only if
 *  formatting the result reproduces the text. */
function parseStyle(text: string, fmt: DateFormatter): number {
  const f = { y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 0, ms: 0 };
  let yy: number | undefined;
  if (fmt.type !== 'time') {
    const long = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{1,4})/.exec(text);
    const short = /(\d{1,2})\/(\d{1,2})\/(\d{2})/.exec(text);
    if (long) { f.mo = MONTHS.findIndex((m) => m.startsWith(long[1])) + 1; f.d = Number(long[2]); f.y = Number(long[3]); }
    else if (short) { f.mo = Number(short[1]); f.d = Number(short[2]); yy = Number(short[3]); }
    else throw new ParseFailed();
  }
  if (fmt.type !== 'date') {
    const t = /(\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)/.exec(text);
    if (!t) throw new ParseFailed();
    f.h = (Number(t[1]) % 12) + (t[4] === 'PM' ? 12 : 0);
    f.mi = Number(t[2]);
    f.s = Number(t[3] ?? 0);
  }
  if (yy !== undefined) f.y = windowYear(f, yy);
  const ms = instantOf(f, fmt.zone);
  if (formatStyle(ms, fmt) !== text) throw new ParseFailed();
  return ms;
}

// ── Builtins ─────────────────────────────────────────────────────────────

const toMs = (v: number, fmt: DateFormatter) => (fmt.unix ? v : Math.round(v * DAY_MS + TM1_EPOCH_MS));
const fromMs = (ms: number, fmt: DateFormatter) => (fmt.unix ? ms : (ms - TM1_EPOCH_MS) / DAY_MS);

function formatterAt(fx: Fixtures | undefined, idx: Value | undefined): DateFormatter | undefined {
  const list = fx?.dateFormatters ?? [];
  return list[idx === undefined ? 0 : Math.trunc(asNumber(idx, 'FormatDate', 2))];
}

export const DATE_FORMAT_BUILTINS: Builtin[] = [
  {
    name: 'NewDateFormatter',
    invoke: (args, fx) => {
      expectArity('NewDateFormatter', args, 1, 6);
      if (asString(args[0]) !== '') throw new Error('NewDateFormatter: a locale other than the default is not simulated');
      const style = asString(args[3] ?? '').toLowerCase();
      const type = asString(args[4] ?? '').toLowerCase();
      const fmt: DateFormatter = {
        zone: resolveZone(asString(args[1] ?? '')),
        unix: asString(args[2] ?? '').toLowerCase() === 'unix',
        style: style === 'full' || style === 'long' || style === 'short' ? style : 'medium',
        type: type === 'time' || type === 'datetime' ? type : 'date',
      };
      if (!fx) return 0;
      fx.dateFormatters ??= [];
      fx.dateFormatters.push(fmt);
      return fx.dateFormatters.length - 1;
    },
  },
  {
    name: 'FormatDate',
    invoke: (args, fx) => {
      expectArity('FormatDate', args, 2, 3);
      const own = formatterAt(fx, args[2]);
      const fmt = own ?? DEFAULT;
      const ms = toMs(asNumber(args[0], 'FormatDate', 0), fmt);
      const pattern = asString(args[1]);
      if (pattern === '' && own) return formatStyle(ms, own);
      return formatPattern(ms, pattern || 'yyyy-MM-dd HH:mm:ss', fmt.zone);
    },
  },
  {
    name: 'ParseDate',
    invoke: (args, fx) => {
      expectArity('ParseDate', args, 1, 3);
      const own = formatterAt(fx, args[2]);
      const fmt = own ?? DEFAULT;
      const text = asString(args[0]);
      // An empty or missing pattern reads the formatter's style. Without one
      // (measured): no formatter at all → '' = 'yyyy-MM-dd HH:mm:ss' and a
      // missing pattern = 'yyyy-MM-dd'; an index with nothing behind it →
      // 'yyyy-MM-dd', the time part is ignored.
      const pattern = args.length < 2 ? '' : asString(args[1]);
      const fallback = (fx?.dateFormatters?.length ?? 0) > 0 || args.length < 2 ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss';
      try {
        const ms = pattern === '' && own ? parseStyle(text, own) : parsePattern(text, pattern || fallback, fmt.zone);
        return fromMs(ms, fmt);
      } catch (e) {
        if (e instanceof ParseFailed) throw new Error(`ParseDate: '${text}' does not match — Invalid real number 'nullptr'`);
        throw e;
      }
    },
  },
];
