import { describe, it, expect } from 'vitest';
import {
  buildCubeStatsMdx,
  parseCubeStats,
  formatBytes,
  statsToCsv,
} from '../cubeStats/cubeStatsApi';
import type { CellsetTable } from '../mdx/cellsetParser';

const mkCell = (v: number) => ({ value: v, formatted: String(v) });

/** Builds a minimal cellset where cols carry the given measure names and rows the given cubes. */
function makeTable(cubes: string[], measureNames: string[], rows: number[][]): CellsetTable {
  return {
    colHeaders: measureNames.map(m => [m]),
    colHierarchies: ['}StatsStatsByCube'],
    rowHeaders: cubes.map(c => [c]),
    rowHierarchies: ['}Cubes'],
    titleHeaders: [],
    cells: rows.map(r => r.map(mkCell)),
    dims: { cols: measureNames.length, rows: cubes.length },
  };
}

describe('buildCubeStatsMdx', () => {
  it('uses given measures + cubes dims and no slicer', () => {
    const mdx = buildCubeStatsMdx('}StatsByCubeStats', '}Cubes');
    expect(mdx).toContain('FROM [}StatsByCube]');
    expect(mdx).toContain('[}StatsByCubeStats]');
    expect(mdx).toContain('[}Cubes]');
    expect(mdx).toContain('TM1FILTERBYLEVEL');
    expect(mdx).not.toContain('WHERE');
  });

  it('honours v12 cubes-dim }PerfCubes', () => {
    const mdx = buildCubeStatsMdx('}StatsStatsByCube', '}PerfCubes');
    expect(mdx).toContain('[}PerfCubes]');
    expect(mdx).not.toContain('[}Cubes]');
  });

  it('appends WHERE slicer when given', () => {
    const mdx = buildCubeStatsMdx('}M', '}C', { dim: '}TimeIntervals', element: 'Latest' });
    expect(mdx).toContain('WHERE ([}TimeIntervals].[Latest])');
  });

  it('escapes "]" in dim/element names to prevent MDX injection', () => {
    const mdx = buildCubeStatsMdx('Foo]Bar', 'A]B', {
      dim: 'D]X',
      element: 'E]Y',
    });
    // each ] in interpolated names must become ]]
    expect(mdx).toContain('[Foo]]Bar]');
    expect(mdx).toContain('[A]]B]');
    expect(mdx).toContain('[D]]X]');
    expect(mdx).toContain('[E]]Y]');
    // bare unescaped name must NOT appear inside brackets
    expect(mdx).not.toContain('[Foo]Bar');
    expect(mdx).not.toContain('[A]B');
  });
});

describe('parseCubeStats', () => {
  it('maps recognised measures by element name (case-insensitive)', () => {
    const t = makeTable(
      ['Sales', 'Plan'],
      ['Total Memory Used', 'Number of Populated Numeric Cells', 'Memory Used for Feeders'],
      [[1000, 50, 200], [500, 30, 100]],
    );
    const out = parseCubeStats(t);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Sales');
    expect(out[0].values.totalMemoryBytes).toBe(1000);
    expect(out[0].values.numericCells).toBe(50);
    expect(out[0].values.memoryFeedersBytes).toBe(200);
    expect(out[1].values.totalMemoryBytes).toBe(500);
  });

  it('marks }-prefixed cubes as system', () => {
    const t = makeTable(['Sales', '}StatsByCube'], ['Total Memory Used'], [[10], [20]]);
    const out = parseCubeStats(t);
    expect(out[0].isSystem).toBe(false);
    expect(out[1].isSystem).toBe(true);
  });

  it('returns 0 for measures missing from cellset', () => {
    const t = makeTable(['X'], ['Total Memory Used'], [[42]]);
    const out = parseCubeStats(t);
    expect(out[0].values.totalMemoryBytes).toBe(42);
    expect(out[0].values.memoryViewsBytes).toBe(0);
    expect(out[0].values.numericCells).toBe(0);
  });

  it('coerces null/strings to 0', () => {
    const t = makeTable(['X'], ['Total Memory Used'], [[42]]);
    t.cells[0][0] = { value: null, formatted: '' };
    const out = parseCubeStats(t);
    expect(out[0].values.totalMemoryBytes).toBe(0);
  });

  it('returns [] on empty rows', () => {
    expect(parseCubeStats(makeTable([], ['Total Memory Used'], []))).toEqual([]);
  });

  it('skips rows with empty cube name', () => {
    const t = makeTable(['', 'OK'], ['Total Memory Used'], [[10], [20]]);
    const out = parseCubeStats(t);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('OK');
  });
});

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toMatch(/^1\.0+ KB$/);
    expect(formatBytes(1024 * 1024)).toMatch(/^1\.0+ MB$/);
  });
  it('returns "0 B" for negative or invalid', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

describe('statsToCsv', () => {
  it('produces a header line plus one record per stat', () => {
    const csv = statsToCsv([
      { name: 'A', isSystem: false, values: { totalMemoryBytes: 100, memoryViewsBytes: 50 } },
    ] as any);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Total Memory Used');
    expect(lines[1]).toContain('A');
    expect(lines[1]).toContain('100');
  });
});
