// src/debugUtility/overfedScanPure.ts
//
// Pure building blocks for the overfeeding scan via `DebugUtility`.
// No `vscode`, no network calls — the calling command passes data in
// and gets strings and structures back.
//
// Everything here rests on measured behaviour, not on documentation:
// IBM does not document `DebugUtility`. Evidence, edge cases and
// run times in `docs/architecture/../analysis/2026-08-31-debugutility-live.md`.
import { escapeTiLiteral } from '../utils/tiLiteral';

/**
 * Mode "print overfed cells" — fed, but without a value.
 *
 * Unlike 113, this mode walks the FEEDER LIST, not the cell space:
 * 1–63 ms on every measured cube, including one with 1.6e23 cells. An
 * area filter is therefore neither needed nor possible — argument 6 is
 * ignored by 105 (measured: a nonsensical filter returns the same as none).
 */
export const MODE_OVERFED = 105;

/**
 * Default for the end of the printed range — i.e. "the first 10000".
 *
 * Why a limit at all and not everything: run time depends on the number of
 * hits (`Cube A`, measured: 75 ms for 1000 cells, 566 ms for 10000,
 * 1451 ms for all 21606 / 1.6 MB), and every hit then costs a table row in the
 * window. Anyone who wants more moves the range.
 */
export const OVERFED_RANGE_END = 10000;

/** Mode "clear cube cache". Belongs before every 105 run, see below. */
export const MODE_CLEAR_CACHE = 125;

/**
 * File name of the output. Must start with `TM1ProcessError_`, otherwise
 * `ErrorLogFiles` does not list the file and it can no longer be fetched.
 */
export function fileNameForRun(stamp: number, seq: number): string {
  return `TM1ProcessError_tm1ide_underfed_${stamp}_${seq}.log`;
}

/** A found cell: cube plus coordinates in dimension order. */
export interface OverfedCell {
  cube: string;
  coordinates: string[];
}

/**
 * Prolog for the overfeeding run (mode 105, whole cube).
 *
 * Arguments 2 and 3 are a RANGE: first and last printed cell,
 * 1-based and inclusive. Measured on 2026-09-01 on 11.8 against the
 * full list of `Cube A` (21606 cells), cache cleared before every run:
 *
 * ```
 * a2=100 a3=500  -> 401 lines = cells 100..500
 * a2=10  a3=20   ->  11 lines = cells  10..20
 * a2=500 a3=502  ->   3 lines = cells 500..502
 * a2=0   a3=10   ->  10 lines — 0 is treated like 1
 * a2=3   a3=3    ->   0 lines — a3 <= a2 returns NOTHING
 * ```
 *
 * Two traps behind this:
 *
 * - `bis <= von` gives an empty file and still reports success. That is why
 *   it is raised to `von + 1` here, instead of handing the caller a "nothing
 *   found" that is not one. That `von = bis` ought to be exactly one cell,
 *   the server sees differently — not our choice.
 * - A late slice is NOT cheaper: the server always runs from the start
 *   and only prints the slice. Measured: cells 100..500 cost 75 ms,
 *   cells 21600..21610 a full 1409 ms — as long as the whole list.
 */
export function buildOverfeedingProlog(
  cube: string, fileName: string, from: number = 1, to: number = OVERFED_RANGE_END,
): string {
  const c = escapeTiLiteral(cube);
  const d = escapeTiLiteral(fileName);
  const v = Math.max(1, Math.floor(from));
  const b = Math.max(Math.floor(to), v + 1);
  // Sixth argument stays empty: 105 does not evaluate it.
  return `DebugUtility(${MODE_OVERFED}, ${v}, ${b}, '${c}', GetProcessErrorFileDirectory() | '${d}', '');`;
}

/**
 * Prolog for clearing the cache — since 2026-09-01 NO LONGER mandatory, but
 * a checkbox.
 *
 * The old evidence ("ten runs reported zero, after clearing 1, 1, 0,
 * 0, 0") was a fallacy: it ran with `a2 = 0, a3 = 1`, i.e. range 1..1,
 * and a range with `a3 <= a2` returns nothing at all. What was measured was
 * the range bug, not the cache.
 *
 * Redone with the full range (2026-09-01, 11.8): five runs in a row
 * WITHOUT clearing reported 21606 every time on a large cube and 427 every
 * time on a smaller one. Clearing costs — on the large one 435 ms
 * without, 1420 ms with.
 *
 * What REMAINS: right after evaluating a rule cell, the smaller cube
 * reported zero instead of 427 twice and recovered on its own later. So the
 * result is not immune to other traffic on the cube.
 * That is why the path stays — as the user's choice, not as the default,
 * because it hits every session on the server.
 */
export function buildClearCacheProlog(cube: string): string {
  return `DebugUtility(${MODE_CLEAR_CACHE}, 0, 0, '${escapeTiLiteral(cube)}', '', '');`;
}

/**
 * Reads the output of mode 105.
 *
 * Format (taken live from a planning cube with nine dimensions) — one
 * plain cell coordinate per line, comma-separated, WITHOUT the `"Cube" [...]`
 * wrapper of mode 113 and without a header line:
 *
 * ```
 * Rule,2026,Plan,1001,2001,3001,Direct,A-B,Value
 * ```
 *
 * `dimensions` only serves as a plausibility check: a line with a different
 * field count is not a coordinate of this cube and is discarded, instead of
 * showing a shifted cell. An element name containing a comma CANNOT be
 * rescued here — the format carries no quotes. Such lines fail the field-count
 * check and come back as `discarded`, so the caller can say so instead of
 * swallowing them silently.
 *
 * `capped` means: the file is as long as the requested range is wide —
 * then the list does not stop because the cube ended, but because the
 * range ended. There is no other marker; 105 writes no header line and
 * reports no total.
 */
export function parseOverfedCells(
  text: string, cube: string, dimensions: readonly string[],
  rangeWidth: number = OVERFED_RANGE_END,
): { cells: OverfedCell[]; discarded: number; capped: boolean } {
  const cells: OverfedCell[] = [];
  let discarded = 0;
  let lineCount = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { continue; }
    lineCount++;
    const parts = line.split(',');
    if (dimensions.length > 0 && parts.length !== dimensions.length) { discarded++; continue; }
    cells.push({ cube, coordinates: parts });
  }
  return { cells, discarded, capped: lineCount >= rangeWidth };
}
