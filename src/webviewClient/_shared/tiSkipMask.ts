/** Pure helper for TI/rules word search — no monaco/dom dependencies. */

/**
 * Marks indices that belong to string literals (single or double quoted)
 * or `#`-comments in a TI source line.
 *
 * Mirrors the legacy implementation so highlights and the references
 * panel skip occurrences inside those spans.
 *
 * - `''` inside a single-quoted string = escaped quote (both bytes masked).
 * - `#` starts a line comment to end-of-line.
 * - Quote chars themselves are masked too.
 */
export function buildTiSkipMask(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!inSingle && !inDouble && ch === '#') {
      for (let j = i; j < line.length; j++) { mask[j] = true; }
      break;
    }
    if (!inDouble && ch === "'") {
      if (!inSingle) { inSingle = true; mask[i] = true; }
      else if (line[i + 1] === "'") { mask[i] = true; mask[++i] = true; }
      else { mask[i] = true; inSingle = false; }
      continue;
    }
    if (!inSingle && ch === '"') {
      if (!inDouble) { inDouble = true; mask[i] = true; }
      else { mask[i] = true; inDouble = false; }
      continue;
    }
    if (inSingle || inDouble) { mask[i] = true; }
  }
  return mask;
}
