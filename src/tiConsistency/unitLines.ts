import type { UnitKey } from './types';

/**
 * Maps a 1-based line number in the COMBINED document (all units joined by a
 * single '\n', per `proc.units.map(u=>u.text).join('\n')`) back to the unit
 * that contains it plus the SECTION-RELATIVE (1-based) line within that unit.
 * Defensive: clamps to the last unit if `combinedLine` falls outside the
 * computed ranges (should not happen for lines produced by the parser, but
 * keeps callers safe against off-by-one drift).
 */
export function combinedLineToUnit(
  units: { key: UnitKey; text: string }[], combinedLine: number,
): { unit: UnitKey; line: number } {
  let offset = 0;
  for (const u of units) {
    const lineCount = u.text.split('\n').length;
    if (combinedLine <= offset + lineCount) {
      return { unit: u.key, line: combinedLine - offset };
    }
    offset += lineCount;
  }
  const last = units[units.length - 1];
  return { unit: last.key, line: Math.max(1, combinedLine - (offset - last.text.split('\n').length)) };
}
