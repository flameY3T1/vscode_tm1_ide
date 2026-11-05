import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildFormat, parseFormat, DEFAULT_BLOCKS, type FormatBlocks } from '../../webviewClient/cubeViewerMonaco/formatBuilderPure';
import { validateTm1Format } from '../../webviewClient/cubeViewerMonaco/tm1FormatPure';

interface Cell { format: string; value: number; tm1: string }
const measured = new Set((JSON.parse(fs.readFileSync(path.join(__dirname, 'tm1FormatFixture.json'), 'utf8')) as { cells: Cell[] })
  .cells.filter((c) => c.tm1 !== 'error').map((c) => c.format));

function* allBlocks(): Generator<FormatBlocks> {
  for (const decimals of [0, 2]) for (const group of [true, false]) for (const negative of ['minus', 'parens'] as const)
    for (const zero of ['zero', 'blank', 'dash'] as const) for (const unit of ['', '€', 'Stk'])
      for (const scale of ['none', 'k', 'm'] as const) for (const percent of [false, true]) {
        if (percent && scale !== 'none') { continue; }
        yield { decimals, group, negative, zero, unit, scale, percent };
      }
}

describe('buildFormat', () => {
  it('every building-block combination was measured on the server and is valid', () => {
    const missing: string[] = [];
    for (const b of allBlocks()) {
      const f = buildFormat(b);
      expect(validateTm1Format(f).ok).toBe(true);
      if (!measured.has(f)) { missing.push(f); }
    }
    expect(missing).toEqual([]);
  });

  it('reads back what it wrote', () => {
    for (const b of allBlocks()) {
      const back = parseFormat(buildFormat(b));
      expect(back && buildFormat(back)).toBe(buildFormat(b));
    }
  });

  it('a scale drops the decimals (TM1 does not scale with a fraction part)', () => {
    expect(buildFormat({ ...DEFAULT_BLOCKS, decimals: 2, scale: 'k' })).toBe('#,##0,');
  });

  it('strips quotes from the unit', () => {
    expect(buildFormat({ ...DEFAULT_BLOCKS, unit: 'a"b' })).toBe('#,##0 "ab"');
  });

  it('anything else is custom', () => {
    expect(parseFormat('0.0 "A";[Red]-0.0')).toBeNull();
    expect(parseFormat('dd.mm.yyyy')).toBeNull();
  });
});
