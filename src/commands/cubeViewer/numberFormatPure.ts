/**
 * Reconciles the one place where an MDX cellset and a NativeView cellset
 * disagree about how a number looks.
 *
 * Measured live against TM1 11.8 (2026-08-08), 780 paired cells over the same
 * grid, once via `Views/tm1.Execute` and once via `ExecuteMDX`:
 *
 * | element `Format` | View FormatString | View shows      | MDX FormatString | MDX shows      |
 * |------------------|-------------------|-----------------|------------------|----------------|
 * | `#,##0;-#,##0`   | `#,##0`           | `1.167.571.059` | `#,##0`          | `1.167.571.059`|
 * | *(none)*         | `''`              | `259.842.568,75`| `0.00`           | `259842568,75` |
 *
 * A format the modeller set comes through identically on both paths. Only the
 * unformatted case differs: the MDX cellset invents the pattern `0.00` and
 * applies it literally, so the thousands separators fall away, while the view
 * leaves the pattern empty and lets the server default group.
 *
 * The repair therefore inserts what the MDX path omits, and nothing else —
 * TM1's own digits, rounding and decimal separator are kept verbatim rather
 * than re-derived from the raw value, so no client locale has to be guessed.
 * Checked against 434 default-format cells: character-identical to the view.
 *
 * Known limit: an element whose format is set to the literal `0.00` is
 * indistinguishable from an unset one on the MDX path and will be grouped.
 */

/** The pattern an MDX cellset reports for cells whose element carries no
 *  `Format` attribute. A NativeView reports `''` for the same cells. */
export const MDX_DEFAULT_FORMAT = '0.00';

/** `sign` `integer` `decimal-separator` `fraction` — one separator only, so an
 *  already-grouped string (two separators) deliberately fails to match. */
const PLAIN_DECIMAL = /^(-?)(\d+)([.,])(\d+)$/;

/**
 * Insert thousands separators into a number TM1 rendered without them. The
 * separator pair is read off the string itself: whichever of `.` / `,` sits
 * before the fraction is the decimal separator, so the other one groups.
 * Anything that is not a plain signed decimal comes back unchanged.
 */
export function insertGroupSeparators(formatted: string): string {
  const m = PLAIN_DECIMAL.exec(formatted);
  if (!m) { return formatted; }
  const [, sign, intPart, decSep, frac] = m;
  if (intPart.length <= 3) { return formatted; }
  const groupSep = decSep === ',' ? '.' : ',';
  return sign + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep) + decSep + frac;
}

/**
 * Display string for one cell: grouped when the server reported the MDX
 * default pattern, verbatim in every other case — a set format is already
 * rendered the way the modeller asked for, and a NativeView's output is
 * already grouped.
 */
export function applyDefaultGrouping(formatted: string, formatString: string | undefined): string {
  return formatString === MDX_DEFAULT_FORMAT ? insertGroupSeparators(formatted) : formatted;
}
