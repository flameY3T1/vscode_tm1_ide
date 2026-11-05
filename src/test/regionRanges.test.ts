import { describe, it, expect } from 'vitest';
import { detectRegionRanges, detectTiFoldRanges } from '../tiLogicVisualizer/regionRanges';

describe('detectRegionRanges', () => {
  it('folds a simple #Region…#EndRegion block', () => {
    const src = ['#Region setup', 'x = 1;', 'y = 2;', '#EndRegion'].join('\n');
    expect(detectRegionRanges(src)).toContainEqual({ startLine: 1, endLine: 4, kind: 'region' });
  });

  it('is case-insensitive and ignores the optional name', () => {
    const src = ['#REGION My Name Here', 'a = 1;', '#endregion My Name Here'].join('\n');
    expect(detectRegionRanges(src)).toContainEqual({ startLine: 1, endLine: 3, kind: 'region' });
  });

  it('nests regions (stack/LIFO): inner and outer fold independently', () => {
    const src = [
      '#Region outer', // 1
      'a = 1;',        // 2
      '#Region inner', // 3
      'b = 2;',        // 4
      '#EndRegion',    // 5  -> closes inner (3..5)
      'c = 3;',        // 6
      '#EndRegion',    // 7  -> closes outer (1..7)
    ].join('\n');
    const r = detectRegionRanges(src);
    expect(r).toContainEqual({ startLine: 3, endLine: 5, kind: 'region' });
    expect(r).toContainEqual({ startLine: 1, endLine: 7, kind: 'region' });
  });

  it('drops an unpaired #Region', () => {
    expect(detectRegionRanges('#Region x\na = 1;')).toEqual([]);
  });

  it('drops an unpaired #EndRegion', () => {
    expect(detectRegionRanges('a = 1;\n#EndRegion')).toEqual([]);
  });

  it('drops a region spanning a single line', () => {
    expect(detectRegionRanges('#Region x\n#EndRegion')).toEqual([]);
  });

  it('returns nothing when there are no markers', () => {
    expect(detectRegionRanges('a = 1;\nb = 2;')).toEqual([]);
  });
});

describe('detectTiFoldRanges', () => {
  it('merges IF/WHILE blocks with region ranges', () => {
    const src = [
      '#Region calc', // 1
      'IF(1=1);',     // 2
      'x = 1;',       // 3
      'ENDIF;',       // 4
      '#EndRegion',   // 5
    ].join('\n');
    const r = detectTiFoldRanges(src);
    expect(r).toContainEqual({ startLine: 2, endLine: 4, kind: 'IF' });
    expect(r).toContainEqual({ startLine: 1, endLine: 5, kind: 'region' });
  });
});
