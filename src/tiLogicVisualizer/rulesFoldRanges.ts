/**
 * Foldable ranges for TM1 cube-rules text.
 *
 *  - `region`  : the calc section under `SKIPCHECK;` (down to `FEEDERS;`), the feeder section
 *                under `FEEDERS;` (down to the last content line), and `#Region … #EndRegion` blocks.
 *  - `comment` : a run of 2+ consecutive `#` comment lines.
 *  - `if`      : reused IF/ENDIF block folding (rules normally use inline `IF()`
 *                functions, so this is usually empty — but harmless when present).
 *
 * Markers inside strings/comments are ignored. Ranges spanning a single line
 * are dropped (nothing to collapse).
 */
import { detectFoldRanges } from './blockRanges';
import { detectRegionRanges } from './regionRanges';

export type RulesFoldKind = 'region' | 'comment' | 'if';

export interface RulesFoldRange {
  startLine: number; // 1-based
  endLine: number;   // 1-based
  kind: RulesFoldKind;
}

/** Strips single-quoted strings and `#` comments, leaving only code chars. */
function stripStringsAndComments(line: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === "'") { inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '#') { break; }
    out += c;
  }
  return out;
}

/** True if the code part of the line is exactly the bare marker (`SKIPCHECK`/`FEEDERS`). */
function isMarker(line: string, marker: string): boolean {
  const code = stripStringsAndComments(line).trim().toUpperCase();
  return code === marker || code === marker + ';';
}

/** True if the line is a pure comment line (`# ...`, ignoring leading whitespace).
 *  Excludes #Region and #EndRegion markers, which break comment runs.
 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  if (/^#(end)?region\b/i.test(t)) { return false; }
  return t.startsWith('#');
}

export function detectRulesFoldRanges(code: string): RulesFoldRange[] {
  const lines = code.split('\n');
  const ranges: RulesFoldRange[] = [];

  // ── SKIPCHECK / FEEDERS region markers ──────────────────────────
  let skip = -1;
  let feeders = -1;
  for (let i = 0; i < lines.length; i++) {
    if (skip < 0 && isMarker(lines[i], 'SKIPCHECK')) { skip = i; }
    if (feeders < 0 && i > skip && isMarker(lines[i], 'FEEDERS')) { feeders = i; }
  }

  // Last line with any content (for the FEEDERS→end fold).
  let lastContent = lines.length - 1;
  while (lastContent >= 0 && lines[lastContent].trim() === '') { lastContent--; }

  if (skip >= 0) {
    const end = feeders > skip ? feeders - 1 : lastContent;
    if (end > skip) { ranges.push({ startLine: skip + 1, endLine: end + 1, kind: 'region' }); }
  }
  if (feeders >= 0 && lastContent > feeders) {
    ranges.push({ startLine: feeders + 1, endLine: lastContent + 1, kind: 'region' });
  }

  // ── Comment blocks (runs of 2+ consecutive # lines) ─────────────
  let runStart = -1;
  for (let i = 0; i <= lines.length; i++) {
    const isCmt = i < lines.length && isCommentLine(lines[i]);
    if (isCmt) {
      if (runStart < 0) { runStart = i; }
    } else {
      if (runStart >= 0 && i - 1 > runStart) {
        ranges.push({ startLine: runStart + 1, endLine: i, kind: 'comment' });
      }
      runStart = -1;
    }
  }

  // ── IF/ENDIF blocks (reuse TI detector; inline IF() is filtered out) ─
  for (const r of detectFoldRanges(code)) {
    ranges.push({ startLine: r.startLine, endLine: r.endLine, kind: 'if' });
  }

  // ── #Region / #EndRegion blocks ───────────────────────────────────
  for (const r of detectRegionRanges(code)) {
    ranges.push({ startLine: r.startLine, endLine: r.endLine, kind: 'region' });
  }

  return ranges.filter(r => r.endLine > r.startLine);
}
