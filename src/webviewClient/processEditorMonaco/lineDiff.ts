/**
 * Minimal line-level diff for the TI formatter. Full-range model replaces make
 * Monaco invalidate every token at once → the whole document flashes uncolored
 * for a frame while it re-tokenizes. Emitting only the changed line ranges keeps
 * unchanged lines' tokens intact, so there's no flash.
 *
 * Pure, vscode/monaco-free → unit-testable.
 */

/** A contiguous change: replace old lines [oldStart, oldEnd) with `lines`. 0-based. */
export interface LineHunk {
  oldStart: number;
  oldEnd: number;
  lines: string[];
}

/** A Monaco-shaped edit (range as a plain IRange + replacement text). */
export interface TextEditOp {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  text: string;
}

/** Guard: LCS table is O(n*m) — above this product fall back to one full replace. */
const LCS_CELL_CAP = 4_000_000;

/**
 * LCS-based line diff. Equal lines become gaps; runs of delete/insert coalesce
 * into one hunk. Returns [] when the inputs are identical.
 */
export function diffLines(a: string[], b: string[]): LineHunk[] {
  const n = a.length;
  const m = b.length;

  if ((n + 1) * (m + 1) > LCS_CELL_CAP) {
    if (n === m && a.every((l, i) => l === b[i])) { return []; }
    return [{ oldStart: 0, oldEnd: n, lines: b.slice() }];
  }

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) { dp.push(new Uint32Array(m + 1)); }
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  const hunks: LineHunk[] = [];
  let curr: LineHunk | null = null;
  const flush = () => { if (curr) { hunks.push(curr); curr = null; } };
  const open = (i: number) => (curr ??= { oldStart: i, oldEnd: i, lines: [] });

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      open(i).oldEnd = i + 1; // delete a[i]
      i++;
    } else {
      open(i).lines.push(b[j]); // insert b[j]
      j++;
    }
  }
  while (i < n) { open(i).oldEnd = i + 1; i++; }
  while (j < m) { open(i).lines.push(b[j]); j++; }
  flush();

  return hunks;
}

/** Reconstruct the new line array by applying hunks to the old line array. */
export function applyHunks(a: string[], hunks: LineHunk[]): string[] {
  const out: string[] = [];
  let i = 0;
  for (const h of hunks) {
    for (; i < h.oldStart; i++) { out.push(a[i]); }
    out.push(...h.lines);
    i = h.oldEnd;
  }
  for (; i < a.length; i++) { out.push(a[i]); }
  return out;
}

/**
 * Map hunks to Monaco edit operations. `lineCount` is the old document's line
 * count; `lineMaxColumn(ln)` returns the 1-based max column of old line `ln`.
 */
export function hunksToEdits(
  hunks: LineHunk[],
  lineCount: number,
  lineMaxColumn: (ln: number) => number,
): TextEditOp[] {
  const edits: TextEditOp[] = [];
  for (const h of hunks) {
    const s = h.oldStart;
    const e = h.oldEnd; // exclusive
    if (e < lineCount) {
      // A line after the block exists → replace from start of s+1 to start of e+1.
      edits.push({
        range: { startLineNumber: s + 1, startColumn: 1, endLineNumber: e + 1, endColumn: 1 },
        text: h.lines.length ? h.lines.join('\n') + '\n' : '',
      });
    } else if (s === 0) {
      // Whole document.
      edits.push({
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: lineCount, endColumn: lineMaxColumn(lineCount) },
        text: h.lines.join('\n'),
      });
    } else {
      // Block runs to EOF: consume the newline at the end of line s too.
      edits.push({
        range: { startLineNumber: s, startColumn: lineMaxColumn(s), endLineNumber: lineCount, endColumn: lineMaxColumn(lineCount) },
        text: h.lines.length ? '\n' + h.lines.join('\n') : '',
      });
    }
  }
  return edits;
}
