import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source-scan guard (built like `noManualBodyRelease.test.ts` /
 * `countFormatGuard.test.ts`): `getTitleAssignments()` must NOT run
 * per cell in the grid.
 *
 * Occasion (review 2026-08-13, finding 2): the call stood as an ARGUMENT in
 * `hasPicklist(matrix, ri, ci, state.dimensions, getTitleAssignments())`.
 * Arguments are evaluated before the body — so the cheap early exit in
 * `hasPicklist` (no maps, no picklist) came too late. Every
 * drawn cell paid for a `querySelectorAll` over the title zone plus
 * a fresh object allocation: at the cell limit, tens of thousands per
 * render — and users WITHOUT any picklist paid for it just the same.
 *
 * A real render run cannot be built here (no jsdom in the project,
 * `renderGrid` depends on the whole DOM machinery), hence the source scan:
 * it hits exactly the shape that makes up the bug.
 */
// Since W3 (2026-10-05) the cell renderer (and its hasPicklist call) lives in
// gridCells.ts; the hoisted call stays in grid.ts. Scan all grid* modules as one.
const GRID_DIR = join(__dirname, '..', '..', 'webviewClient', 'cubeViewerMonaco');
const GRID = ['grid.ts', 'gridAxes.ts', 'gridLabels.ts', 'gridHeader.ts', 'gridCells.ts', 'gridClick.ts', 'gridResize.ts']
  .map((f) => readFileSync(join(GRID_DIR, f), 'utf8'))
  .join('\n');

describe('grid.ts — getTitleAssignments once per render, not per cell', () => {
  it('calls it exactly ONCE in the whole module', () => {
    const calls = GRID.match(/getTitleAssignments\(\)/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it('keeps the result in a constant instead of building it as an argument', () => {
    expect(GRID).toMatch(/const titleAssignments = getTitleAssignments\(\);/);
    // The one call is NOT inside an argument list.
    expect(GRID).not.toMatch(/\(\s*[^)]*,\s*getTitleAssignments\(\)/);
  });

  it('passes the constant on to hasPicklist', () => {
    expect(GRID).toMatch(/hasPicklist\([^)]*titleAssignments\)/);
  });
});
