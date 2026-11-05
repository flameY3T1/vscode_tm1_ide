/**
 * Switch the separator of an already rendered number — without re-rendering
 * the number.
 *
 * Why not simply reformat from the raw value: for the cellset path,
 * `numberFormatPure.ts` holds the line "TM1's digits, rounding and separators
 * verbatim, only add what is missing". A `toLocaleString` from the raw value
 * would overwrite exactly that — the number of decimal places set by the
 * modeller would be lost and the rounding would come from JavaScript instead of
 * TM1.
 *
 * There are only two conventions: `.` groups and `,` separates the decimals
 * (German), or the reverse (English). The switch between them is therefore
 * always the same: every `.` becomes `,` and every `,` becomes `.`. The only
 * question is which convention the string is currently in.
 */

/** Grouped (`1.234.567,89`) or plain (`1234,89`), each with an optional `%` suffix. */
const NUM_GROUPED = /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*%?$/;
const NUM_PLAIN = /^-?\d+(?:[.,]\d+)?\s*%?$/;

/**
 * Is the string in the convention "comma separates the decimals"?
 * `null` means: it contains no separator at all, so there is nothing to say
 * and nothing to do.
 */
export function usesCommaDecimal(s: string, raw: string | undefined): boolean | null {
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots === 0 && commas === 0) { return null; }
  // Both present: the last one separates the decimals, the other one groups.
  if (dots > 0 && commas > 0) { return s.lastIndexOf(',') > s.lastIndexOf('.'); }

  const only = dots > 0 ? '.' : ',';
  // Occurring several times means grouping — decimals occur only once.
  if ((dots > 0 ? dots : commas) > 1) { return only === '.'; }

  const after = s.slice(s.indexOf(only) + 1).replace(/[\s%]/g, '');
  // Anything other than exactly three digits cannot be a thousands group.
  if (after.length !== 3) { return only === ','; }
  // Neither can a separator with more than three digits in front of it:
  // `1234567,375` (format `0.000`) is a decimal comma, not a group.
  const before = s.slice(0, s.indexOf(only)).replace(/\D/g, '');
  if (before.length > 3) { return only === ','; }

  // Exactly three digits: `1.234` cannot be decided from the string alone.
  // The raw value knows — from 1000 upwards it was a thousands group.
  const n = raw === undefined ? NaN : Math.abs(Number(raw));
  const grouping = Number.isFinite(n) ? n >= 1000 : true;
  return grouping ? only === '.' : only === ',';
}

/**
 * Bring the display to the desired separator. Non-numbers and numbers without
 * a separator are returned unchanged — the number button must not touch a text
 * cell.
 */
export function applyDecimalSeparator(
  formatted: string, raw: string | undefined, wantComma: boolean,
): string {
  const s = formatted.trim();
  if (!s) { return formatted; }
  if (NUM_GROUPED.test(s) || NUM_PLAIN.test(s)) { return swapIfNeeded(formatted, raw, wantComma); }
  // A FORMAT_STRING wraps the number in text: `533.318 €`, `(1.234.567)`,
  // `1.235k`. Only the number in the middle is swapped — and only for a cell
  // whose raw value is a number, so a text cell like `Version 2.1` stays put.
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(Number(raw))) { return formatted; }
  const m = WRAPPED_NUM.exec(formatted);
  if (!m || !(NUM_GROUPED.test(m[2]) || NUM_PLAIN.test(m[2]))) { return formatted; }
  return m[1] + swapIfNeeded(m[2], raw, wantComma) + m[3];
}

/** Text without digits or separators around one number. */
const WRAPPED_NUM = /^([^\d.,]*?)(-?\d[\d.,]*)([^\d.,]*)$/;

function swapIfNeeded(num: string, raw: string | undefined, wantComma: boolean): string {
  const isComma = usesCommaDecimal(num, raw);
  if (isComma === null || isComma === wantComma) { return num; }
  return num.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
}
