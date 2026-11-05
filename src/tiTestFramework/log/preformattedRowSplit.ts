/**
 * Splits a pre-formatted row string (`"a";"b";"c"` or `a;b;c`) into its fields,
 * honouring `"..."` quoted regions so embedded `;` inside a value stays intact.
 * Returns the original string as a 1-element array when no top-level `;` is
 * present.
 *
 * Used by both the simulator's op-emitter and the capture-log parser to keep
 * `__TEXTOUTPUT__` / `__ASCIIOUTPUT__` rows aligned: bedrock-style export
 * builds the row via `Expand` as ONE string with embedded `pFieldDelim`
 * separators, so both sides must split it the same way before diffing.
 */
export function splitPreFormattedRow(s: string): string[] {
  if (s.indexOf(';') < 0) return [s];
  const out: string[] = [];
  let buf = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (inQ && s[i + 1] === '"') {
        buf += '"';
        i++;
        continue;
      }
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ';') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

/** Op names whose arg lists may contain a pre-formatted `;`-delimited row
 *  that should be split for consistent diffing. */
export const PREFORMATTED_ROW_OPS: ReadonlySet<string> = new Set([
  '__TEXTOUTPUT__',
  '__ASCIIOUTPUT__',
  '__SETOUTPUTCHARSET__',
]);
