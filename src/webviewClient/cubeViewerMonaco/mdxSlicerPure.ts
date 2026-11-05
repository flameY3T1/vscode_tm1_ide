// Pure heuristic: surgically replaces only the WHERE slicer of an MDX and leaves
// WITH / SELECT axes / FROM untouched. Real webview JS — single backslash.

// Member reference since B1 (2026-08-19) from `mdxParts.ts` — there were three
// copies of the same building block here, in `mdxBuild.ts` and `mdxPivotPure.ts`.
import { memberRef } from './mdxParts';

// True if the keyword is at position i (case-insensitive) and has a word
// boundary on both sides.
function matchKeywordAt(mdx: string, i: number, kw: string): boolean {
  if (mdx.slice(i, i + kw.length).toUpperCase() !== kw) { return false; }
  const before = i > 0 ? mdx[i - 1] : ' ';
  const after = i + kw.length < mdx.length ? mdx[i + kw.length] : ' ';
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  return !isWord(before) && !isWord(after);
}

// Returns all top-level occurrences (outside [..] quoting and ()/{} depth).
// The [] quoting respects the TM1 escape ]].
function topLevelIndices(mdx: string, kw: string): number[] {
  const hits: number[] = [];
  let inBracket = false;
  let depth = 0;
  for (let i = 0; i < mdx.length; i++) {
    const c = mdx[i];
    if (inBracket) {
      if (c === ']') {
        if (mdx[i + 1] === ']') { i++; } else { inBracket = false; }
      }
      continue;
    }
    if (c === '[') { inBracket = true; continue; }
    if (c === '(' || c === '{') { depth++; continue; }
    if (c === ')' || c === '}') { if (depth > 0) { depth--; } continue; }
    if (depth === 0 && matchKeywordAt(mdx, i, kw)) { hits.push(i); }
  }
  return hits;
}

export function rewriteMdxSlicer(
  originalMdx: string,
  titleAssignments: Record<string, string>,
): string {
  if (!originalMdx) { return originalMdx; }

  const fromHits = topLevelIndices(originalMdx, 'FROM');
  if (fromHits.length === 0) { return originalMdx; } // bare set / no FROM

  const fromIdx = fromHits[fromHits.length - 1]; // letztes top-level FROM
  const whereHits = topLevelIndices(originalMdx, 'WHERE').filter((w) => w > fromIdx);
  const cutIdx = whereHits.length > 0 ? whereHits[0] : originalMdx.length;

  const head = originalMdx.slice(0, cutIdx).replace(/\s+$/, '');

  const dims = Object.keys(titleAssignments);
  if (dims.length === 0) { return head; }

  const refs = dims.map((d) => memberRef(d, titleAssignments[d])).join(', ');
  return `${head}\nWHERE (${refs})`;
}
