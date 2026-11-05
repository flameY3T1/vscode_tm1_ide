/**
 * Pure (no-vscode) shared utilities for TI identifier analysis.
 * Safe to import from webview bundles.
 */

import { escapeRegex } from '../utils/escapeRegexPure';

/**
 * For a single line of TI code, returns a boolean mask where true means
 * the character is inside a string literal or line comment.
 * String literals use single quotes; escaped quote inside string = two consecutive quotes.
 * Line comments start with #.
 */
export function buildSkipMask(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (!inString && line[i] === "'") {
      inString = true;
      mask[i] = true;
    } else if (inString) {
      mask[i] = true;
      if (line[i] === "'" && i + 1 < line.length && line[i + 1] === "'") {
        mask[++i] = true;
      } else if (line[i] === "'") {
        inString = false;
      }
    } else if (line[i] === '#') {
      for (let j = i; j < line.length; j++) { mask[j] = true; }
      break;
    }
  }
  return mask;
}

export interface OccurrenceRange {
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * Pure variant: finds all ranges in `text` where `word` appears as a whole
 * word (case-insensitive), excluding string literals and line comments.
 */
export function findAllOccurrencesPure(text: string, word: string): OccurrenceRange[] {
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
  const ranges: OccurrenceRange[] = [];
  if (text.length === 0) { return ranges; }
  const lines = text.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const mask = buildSkipMask(lineText);
    wordRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(lineText)) !== null) {
      if (!mask[m.index]) {
        ranges.push({ line: lineIdx, startCol: m.index, endCol: m.index + m[0].length });
      }
    }
  }
  return ranges;
}
