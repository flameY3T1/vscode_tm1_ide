/**
 * Render a number the way TM1 renders an MDX `FORMAT_STRING`, and tell which
 * format strings TM1 will answer with "error".
 *
 * Every rule below was measured on TM1 11.8 (2026-09-27, 578 cells, fixture
 * `src/test/cubeViewer/tm1FormatFixture.json`); where TM1 differs from Excel,
 * TM1 wins. Used for the format helper's live preview and for display formats
 * the user sets in the cube viewer — the server itself never sees them.
 */

export interface Separators { dec: string; grp: string }

const DE: Separators = { dec: ',', grp: '.' };

/** Unquoted characters TM1 accepts in a number format. Anything else outside
 *  quotes (letters, `€`, `[`, `!`, ...) renders "error"; `:` and `/` switch to
 *  a time/date pattern and render empty. `$` is the server's currency symbol. */
const ALLOWED_UNQUOTED = new Set(['0', '#', '.', ',', '%', ' ', '-', '+', '(', ')', '$', 'E', 'e']);
const DATE_PARTS = /yyyy|yy|mm|dd/g;
// No separate `yyyy`: it is `yy` twice, and the overlap made the match backtrack exponentially (ReDoS).
const DATE_ONLY = /^(?:yy|mm|dd|[./\- ])+$/;

export type FormatCheck = { ok: true } | { ok: false; reason: FormatProblem; at?: string };
export type FormatProblem =
  | 'empty' | 'tooManySections' | 'expression' | 'unquotedText' | 'unclosedQuote'
  | 'colour' | 'namedFormat' | 'prefix' | 'timePattern' | 'noDigits';

/** Split on `;` outside quotes. */
function splitSections(f: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const c of f) {
    if (c === '"') { quoted = !quoted; }
    if (c === ';' && !quoted) { out.push(cur); cur = ''; } else { cur += c; }
  }
  out.push(cur);
  return out;
}

type Token = { lit: string } | { ch: string };

function tokenize(sec: string): Token[] {
  const t: Token[] = [];
  let i = 0;
  while (i < sec.length) {
    const c = sec[i];
    if (c === '"') {
      const j = sec.indexOf('"', i + 1);
      t.push({ lit: sec.slice(i + 1, j < 0 ? undefined : j) });
      i = j < 0 ? sec.length : j + 1;
    } else if (c === '\\') {
      t.push({ lit: sec[i + 1] ?? '' });
      i += 2;
    } else {
      t.push({ ch: c });
      i++;
    }
  }
  return t;
}

const isDate = (sec: string) => DATE_ONLY.test(sec.replace(/"[^"]*"/g, '')) && /[dy]/.test(sec);

/**
 * Which format strings the helper lets through. Rejects every format TM1
 * answers with "error", and on top the ones TM1 renders empty or as garbage
 * (`:`/`/` outside a date, `_x`, `*x`) — no user wants those either.
 */
export function validateTm1Format(format: string): FormatCheck {
  const f = format.trim();
  if (!f) { return { ok: false, reason: 'empty' }; }
  if (/^\s*IIF\s*\(/i.test(f)) { return { ok: false, reason: 'expression' }; }
  if (/^(standard|percent|fixed|currency|general number|scientific)$/i.test(f)) {
    return { ok: false, reason: 'namedFormat' };
  }
  if (/^[a-z]:/i.test(f)) { return { ok: false, reason: 'prefix', at: f.slice(0, 2) }; }
  if ((f.match(/"/g) ?? []).length % 2) { return { ok: false, reason: 'unclosedQuote' }; }
  const secs = splitSections(f);
  if (secs.length > 3) { return { ok: false, reason: 'tooManySections' }; }
  for (const sec of secs) {
    if (/\[[^\]]*\]/.test(sec.replace(/"[^"]*"/g, ''))) { return { ok: false, reason: 'colour' }; }
    if (isDate(sec)) { continue; }
    let digits = false;
    for (const t of tokenize(sec)) {
      if ('lit' in t) { continue; }
      if (t.ch === ':' || t.ch === '/') { return { ok: false, reason: 'timePattern', at: t.ch }; }
      if (!ALLOWED_UNQUOTED.has(t.ch)) { return { ok: false, reason: 'unquotedText', at: t.ch }; }
      if (t.ch === '0' || t.ch === '#') { digits = true; }
    }
    // A section of pure text is fine (zero section `"–"`), but the first one
    // has to show the number.
    if (!digits && sec === secs[0]) { return { ok: false, reason: 'noDigits' }; }
  }
  return { ok: true };
}

/** Round half away from zero on the 15-digit decimal form, as TM1 does
 *  (`999.995` → `1.000,00`, `-0.5` → `-1`). Returns [integer, fraction]. */
function roundDigits(x: number, dec: number): [string, string] {
  const s = Math.abs(Number(x.toPrecision(15))).toFixed(Math.min(dec + 3, 20));
  const [ip, fp = ''] = s.split('.');
  const digits = (ip + fp.slice(0, dec)).split('').map(Number);
  if (Number(fp[dec] ?? 0) >= 5) {
    let k = digits.length - 1;
    while (k >= 0) {
      if (digits[k] === 9) { digits[k] = 0; k--; } else { digits[k]++; break; }
    }
    if (k < 0) { digits.unshift(1); }
  }
  const all = digits.join('');
  const intLen = all.length - dec;
  return [all.slice(0, intLen).replace(/^0+/, ''), all.slice(intLen)];
}

/** Does `value` round to 0 under the digits of this section (percent included)? */
function roundsToZero(value: number, sec: string): boolean {
  const plain = sec.replace(/"[^"]*"/g, '');
  const m = /[0#][0#,]*(?:\.([0#]*))?/.exec(plain);
  if (!m || /[0#],/.test(plain.replace(/[0#],(?=[0#])/g, ''))) { return false; }
  const x = Math.abs(value) * (plain.includes('%') ? 100 : 1);
  const [ip, fp] = roundDigits(x, (m[1] ?? '').length);
  return !/[1-9]/.test(ip + fp);
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Excel serial date (day 0 = 1899-12-30); TM1 renders values below 1 empty. */
function formatDate(v: number, sec: string): string {
  if (!(v >= 1)) { return ''; }
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
  if (Number.isNaN(d.getTime())) { return ''; }
  return sec.replace(/"([^"]*)"/g, '$1').replace(DATE_PARTS, (m) =>
    m === 'yyyy' ? String(d.getUTCFullYear())
      : m === 'yy' ? pad(d.getUTCFullYear() % 100, 2)
        : m === 'mm' ? pad(d.getUTCMonth() + 1, 2)
          : pad(d.getUTCDate(), 2));
}

/**
 * The text TM1 shows for `value` under `format`. Call `validateTm1Format`
 * first: an invalid format gets `'error'`, like on the server.
 */
export function formatTm1(value: number, format: string, sep: Separators = DE): string {
  if (!validateTm1Format(format).ok) { return 'error'; }
  const secs = splitSections(format);
  // A negative value that rounds to zero is shown as zero, in the positive
  // section (`-0.004` with `#,##0;(#,##0)` → `0`). Not with scaling commas:
  // there TM1 keeps the sign (`-0.004` with `#,##0,` → `-0`).
  const neg = value < 0 && !roundsToZero(value, secs[0]);
  let sec = secs[0];
  let signInSection = false;
  // Zero section only for an exact 0; the negative section drops the sign.
  if (value === 0 && secs.length >= 3) { sec = secs[2]; }
  else if (neg && secs.length >= 2) { sec = secs[1]; signInSection = true; }
  if (isDate(sec)) { return formatDate(value, sec); }

  const exp = /^([0#.,]+)E([+-])(0+)(.*)$/i.exec(sec);
  if (exp) {
    const x = Math.abs(value);
    const dec = (exp[1].split('.')[1] ?? '').length;
    let e = x === 0 ? 0 : Math.floor(Math.log10(x));
    let [ip, fp] = roundDigits(x / 10 ** e, dec);
    if (ip.length > 1) { e++; [ip, fp] = roundDigits(x / 10 ** e, dec); }
    return (neg ? '-' : '') + (ip || '0') + (dec ? sep.dec + fp : '')
      + 'E' + (e < 0 ? '-' : '+') + pad(Math.abs(e), exp[3].length) + exp[4];
  }

  const tk = tokenize(sec);
  const text = (ts: Token[]) => ts.map((t) => ('lit' in t ? t.lit : t.ch === '$' ? '€' : t.ch)).join('');
  const isPh = (t: Token) => 'ch' in t && (t.ch === '0' || t.ch === '#');
  const first = tk.findIndex(isPh);
  if (first < 0) { return text(tk); }
  const last = tk.length - 1 - [...tk].reverse().findIndex(isPh);
  const body = tk.slice(first, last + 1).map((t) => ('ch' in t ? t.ch : '')).join('');
  const pre = tk.slice(0, first);
  let post = tk.slice(last + 1);

  let x = Math.abs(value);
  if (tk.some((t) => 'ch' in t && t.ch === '%')) { x *= 100; }
  // Scaling commas right behind the last placeholder divide by 1000 — but only
  // without a fraction part (`#,##0.0,"k"` stays unscaled on 11.8).
  while (post[0] && 'ch' in post[0] && post[0].ch === ',') {
    if (!body.includes('.')) { x /= 1000; }
    post = post.slice(1);
  }

  const di = body.indexOf('.');
  const intPat = di < 0 ? body : body.slice(0, di);
  const fracPh = ((di < 0 ? '' : body.slice(di + 1)).match(/[0#]/g) ?? []).join('');
  // `#` is optional only behind the last `0`: `#.##0,00` keeps five places.
  const minDec = fracPh.lastIndexOf('0') + 1;
  let [ip, fp] = roundDigits(x, fracPh.length);
  ip = ip.padStart((intPat.match(/0/g) ?? []).length, '0');
  if (!ip && !fracPh.length) { ip = '0'; }
  if (body.includes(',')) { ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, sep.grp); }
  fp = fp.replace(/0+$/, '').padEnd(minDec, '0');
  const num = ip + (fp ? sep.dec + fp : '');
  return (neg && !signInSection ? '-' : '') + text(pre) + num + text(post);
}
