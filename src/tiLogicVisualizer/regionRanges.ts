/**
 * Detects foldable #Region … #EndRegion ranges.
 *
 * Markers are matched case-insensitively at the start of a line (after optional
 * whitespace); any trailing name is ignored. Pairing is stack-based (LIFO), so
 * nested regions fold independently. Unpaired markers are dropped, as are
 * regions spanning a single line.
 */
import { detectFoldRanges, type FoldRange } from './blockRanges';

const RE_REGION = /^\s*#region\b/i;
const RE_ENDREGION = /^\s*#endregion\b/i;

export function detectRegionRanges(code: string): FoldRange[] {
  const lines = code.split('\n');
  const stack: number[] = []; // 1-based start line numbers of open #Region markers
  const ranges: FoldRange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (RE_ENDREGION.test(line)) {
      const start = stack.pop();
      if (start !== undefined) {
        ranges.push({ startLine: start, endLine: i + 1, kind: 'region' });
      }
    } else if (RE_REGION.test(line)) {
      stack.push(i + 1);
    }
  }

  // Keep only regions with at least one content line between the markers
  // (endLine > startLine + 1). A bare #Region/#EndRegion pair has nothing to fold.
  // Note: this is intentionally stricter than detectFoldRanges (endLine > startLine).
  return ranges.filter(r => r.endLine > r.startLine + 1);
}

/** IF/WHILE blocks plus #Region ranges — used by the TI Monaco provider and the
 *  plain-file folding provider so both behave identically. */
export function detectTiFoldRanges(code: string): FoldRange[] {
  return [...detectFoldRanges(code), ...detectRegionRanges(code)];
}
