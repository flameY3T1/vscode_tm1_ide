import { describe, it, expect } from 'vitest';
import {
  fileNameForRun,
  MODE_OVERFED,
  MODE_CLEAR_CACHE,
  OVERFED_RANGE_END,
  buildOverfeedingProlog,
  buildClearCacheProlog,
  parseOverfedCells,
} from '../../debugUtility/overfedScanPure';

describe('fileNameForRun', () => {
  // Without the prefix, `ErrorLogFiles` does not list the file — the output would be
  // written, but could no longer be fetched.
  it('starts with TM1ProcessError_', () => {
    expect(fileNameForRun(17, 0).startsWith('TM1ProcessError_')).toBe(true);
  });

  it('distinguishes two runs with the same timestamp', () => {
    expect(fileNameForRun(17, 0)).not.toBe(fileNameForRun(17, 1));
  });
});

describe('buildOverfeedingProlog', () => {
  it('sets mode 105 with the default range', () => {
    const p = buildOverfeedingProlog('Sales', 'TM1ProcessError_x.log');
    expect(p).toContain(`DebugUtility(${MODE_OVERFED}, 1, ${OVERFED_RANGE_END}, 'Sales'`);
  });

  // Measured 2026-09-01 on 11.8 against the full list of `Reporting`
  // (21606 cells): arguments 2 and 3 are the first and last cell, 1-based
  // and inclusive. a2=100/a3=500 returned exactly cells 100..500.
  it('passes a range through', () => {
    expect(buildOverfeedingProlog('Sales', 'f.log', 100, 500))
      .toContain(`DebugUtility(${MODE_OVERFED}, 100, 500, 'Sales'`);
  });

  // With to <= from, the server writes an empty file AND reports success —
  // measured with a2=3/a3=3: zero lines. Such a range must not reach the user
  // as "nothing found".
  it('raises "to" above "from" instead of running an empty pass', () => {
    expect(buildOverfeedingProlog('Sales', 'f.log', 3, 3))
      .toContain(`DebugUtility(${MODE_OVERFED}, 3, 4, 'Sales'`);
    expect(buildOverfeedingProlog('Sales', 'f.log', 900, 100))
      .toContain(`DebugUtility(${MODE_OVERFED}, 900, 901, 'Sales'`);
  });

  // 0 is treated by the server like 1 (measured); we send 1 right away, so that
  // the range in the window and the range on the server are the same.
  it('starts at 1, not at 0', () => {
    expect(buildOverfeedingProlog('Sales', 'f.log', 0, 10))
      .toContain(`DebugUtility(${MODE_OVERFED}, 1, 10, 'Sales'`);
  });

  // 105 does not evaluate argument 6 (nonsensical filter = no filter). A
  // filled-in filter would only pretend that the run is narrowed down.
  it('leaves the range filter empty', () => {
    expect(buildOverfeedingProlog('Sales', 'f.log').endsWith(`'f.log', '');`)).toBe(true);
  });
});

describe('buildClearCacheProlog', () => {
  it('sets mode 125 without a file', () => {
    expect(buildClearCacheProlog('Sales')).toBe(`DebugUtility(${MODE_CLEAR_CACHE}, 0, 0, 'Sales', '', '');`);
  });

  it('verdoppelt Hochkommata', () => {
    expect(buildClearCacheProlog("O'Brien")).toContain("'O''Brien'");
  });
});

describe('parseOverfedCells', () => {
  const dims = ['Datenart', 'Jahr', 'Version', 'Konto', 'Kostenstelle', 'Auftrag', 'Kanal', 'Relation', 'Wertfeld'];
  // Structure from the live run against a planning cube, values neutralized:
  // nine fields, comma-separated, without quotation marks.
  const echt = 'Rule,2026,PLAN,4711,0815,0031,DIREKT,A-B,Wert';

  it('reads a coordinate without a header line and without a wrapper', () => {
    const r = parseOverfedCells(echt, 'Planung', dims);
    expect(r.cells).toEqual([{
      cube: 'Planung',
      coordinates: ['Rule', '2026', 'PLAN', '4711', '0815', '0031', 'DIREKT', 'A-B', 'Wert'],
    }]);
    expect(r.discarded).toBe(0);
  });

  // The format carries no quotation marks — a comma in the element name cannot
  // be reconstructed. Such lines must STAND OUT, not pass as a
  // shifted cell.
  it('discards lines with the wrong number of fields instead of shifting them', () => {
    const r = parseOverfedCells(`${echt},zuviel`, 'C', dims);
    expect(r.cells).toEqual([]);
    expect(r.discarded).toBe(1);
  });

  it('without a dimension list nothing is checked', () => {
    const r = parseOverfedCells('a,b', 'C', []);
    expect(r.cells).toHaveLength(1);
  });

  it('empty output means nothing found', () => {
    expect(parseOverfedCells('\r\n\r\n', 'C', dims))
      .toEqual({ cells: [], discarded: 0, capped: false });
  });

  // 105 writes no header line and gives no total count — that something follows
  // after the last line can only be recognized by the
  // file being as long as the range is wide. Measured: `Reporting` returned exactly
  // 1000 lines for 1..1000 and in truth has 21606.
  it('recognizes the full range', () => {
    const text = [echt, echt, echt].join('\r\n');
    expect(parseOverfedCells(text, 'C', dims, 3).capped).toBe(true);
    expect(parseOverfedCells(text, 'C', dims, 4).capped).toBe(false);
  });

  // Discarded lines count too: TM1 did output them, we just could not
  // read them. Otherwise a full file would wrongly mean "nothing more
  // is coming".
  it('counts discarded lines towards the range', () => {
    const r = parseOverfedCells(`${echt}\r\n${echt},zuviel`, 'C', dims, 2);
    expect(r.cells).toHaveLength(1);
    expect(r.discarded).toBe(1);
    expect(r.capped).toBe(true);
  });
});
