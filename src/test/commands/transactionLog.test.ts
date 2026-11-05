import { describe, it, expect } from 'vitest';
import {
  buildTransactionLogFilter, buildTransactionLogPath, type TransactionLogQuery,
} from '../../tm1Rest/transactionLogApi';
import {
  buildCellMdx, windowStart, toOdataInstant, resolveWindow,
  planCellUndo, sameCellValue, undoWireValue, buildCellsReadMdx, orderSameSecond,
  WINDOW_HOURS, TOP_OPTIONS, MAX_TOP, WARN_SPAN_HOURS,
} from '../../commands/transactionLogPure';

const base: TransactionLogQuery = { fromIso: '2026-09-15T00:00:00Z', top: 1000 };

describe('buildTransactionLogFilter', () => {
  it('always windows and excludes control cubes by default', () => {
    expect(buildTransactionLogFilter(base)).toBe(
      "TimeStamp ge 2026-09-15T00:00:00Z and not startswith(Cube,'}')",
    );
  });

  it('keeps control cubes in when asked', () => {
    expect(buildTransactionLogFilter({ ...base, includeControl: true })).toBe(
      'TimeStamp ge 2026-09-15T00:00:00Z',
    );
  });

  it('adds the upper bound, cube, user and element in the measured spellings', () => {
    const f = buildTransactionLogFilter({
      ...base,
      toIso: '2026-09-16T00:00:00Z',
      cube: 'Planung',
      user: 'someone',
      element: 'LAST_TIME_UPDATED',
      includeControl: true,
    });
    expect(f).toBe(
      'TimeStamp ge 2026-09-15T00:00:00Z and TimeStamp le 2026-09-16T00:00:00Z'
      + " and Cube eq 'Planung' and User eq 'someone'"
      + " and Tuple/any(t: t eq 'LAST_TIME_UPDATED')",
    );
  });

  it("doubles a quote in a name instead of breaking the filter", () => {
    expect(buildTransactionLogFilter({ ...base, cube: "O'Brien", includeControl: true }))
      .toContain("Cube eq 'O''Brien'");
  });
});

describe('buildTransactionLogPath', () => {
  it('orders newest first, asks for the inline count and encodes the filter', () => {
    const path = buildTransactionLogPath({ ...base, top: 500 });
    expect(path.startsWith('TransactionLogEntries?$orderby=TimeStamp desc&$top=500&$count=true&$filter=')).toBe(true);
    expect(path).not.toContain('$orderby=ID');
    // The filter has to be encoded — a raw space turns it into a
    // second query option.
    expect(path).toContain('TimeStamp%20ge%202026-09-15T00%3A00%3A00Z');
  });

  it('never asks for less than one row', () => {
    expect(buildTransactionLogPath({ ...base, top: 0 })).toContain('$top=1');
  });
});

describe('buildCellMdx', () => {
  it('puts the first two dimensions on axes and the rest in WHERE', () => {
    expect(buildCellMdx('Sales', ['Year', 'Month', 'Region', 'Measure'], ['2026', 'Jan', 'North', 'Value']))
      .toBe('SELECT {[Year].[2026]} ON 0, {[Month].[Jan]} ON 1 FROM [Sales] WHERE ([Region].[North], [Measure].[Value])');
  });

  it('works for a two-dimensional cube without a WHERE part', () => {
    expect(buildCellMdx('C', ['A', 'B'], ['a', 'b'])).toBe('SELECT {[A].[a]} ON 0, {[B].[b]} ON 1 FROM [C]');
  });

  it('escapes a closing bracket in a name', () => {
    expect(buildCellMdx('C', ['A]x', 'B'], ['a', 'b'])).toContain('[A]]x]');
  });

  it('refuses to guess when tuple and dimensions do not line up', () => {
    expect(buildCellMdx('C', ['A', 'B'], ['a'])).toBeNull();
    expect(buildCellMdx('C', [], [])).toBeNull();
    expect(buildCellMdx('', ['A'], ['a'])).toBeNull();
    expect(buildCellMdx('C', ['A', ''], ['a', 'b'])).toBeNull();
  });
});

describe('window helpers', () => {
  it('formats instants the way the filter needs them — seconds, Z, no milliseconds', () => {
    expect(toOdataInstant(new Date('2026-09-22T10:00:00.123Z'))).toBe('2026-09-22T10:00:00Z');
  });

  it('subtracts the chosen hours from now', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    expect(windowStart(24, now)).toBe('2026-09-21T12:00:00Z');
    expect(windowStart(1, now)).toBe('2026-09-22T11:00:00Z');
  });

  it('falls back to a day for a nonsense window instead of asking for everything', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    expect(windowStart(0, now)).toBe('2026-09-21T12:00:00Z');
    expect(windowStart(Number.NaN, now)).toBe('2026-09-21T12:00:00Z');
  });

  it('caps the row count at the largest offered option', () => {
    expect(MAX_TOP).toBe(Math.max(...TOP_OPTIONS));
    expect(WINDOW_HOURS.every(h => h > 0)).toBe(true);
  });
});

describe('resolveWindow — the search form', () => {
  const now = new Date('2026-09-22T12:00:00Z');

  it('takes the quick window when no bound is typed', () => {
    expect(resolveWindow({ hours: 24 }, now)).toEqual({
      fromIso: '2026-09-21T12:00:00Z', toIso: undefined, spanHours: 24,
    });
  });

  it('lets typed bounds win over the quick window', () => {
    const r = resolveWindow({ fromLocal: '2026-09-20T00:00', toLocal: '2026-09-21T00:00', hours: 720 }, now);
    // Local time in, UTC out — the bounds shift by the zone offset.
    expect(r.fromIso).toBe(toOdataInstant(new Date('2026-09-20T00:00')));
    expect(r.toIso).toBe(toOdataInstant(new Date('2026-09-21T00:00')));
    expect(r.spanHours).toBe(24);
  });

  it('swaps reversed bounds instead of returning an empty window', () => {
    const r = resolveWindow({ fromLocal: '2026-09-21T00:00', toLocal: '2026-09-20T00:00' }, now);
    expect(new Date(r.fromIso).getTime()).toBeLessThan(new Date(r.toIso as string).getTime());
    expect(r.spanHours).toBe(24);
  });

  it('runs to now when only the lower bound is given', () => {
    const r = resolveWindow({ fromLocal: '2026-09-22T00:00' }, new Date('2026-09-22T06:00'));
    expect(r.toIso).toBeUndefined();
    expect(r.spanHours).toBe(6);
  });

  it('ignores an unusable field and falls back to the quick window', () => {
    expect(resolveWindow({ fromLocal: 'Unfug', hours: 8 }, now).fromIso).toBe('2026-09-22T04:00:00Z');
  });

  it('warns from a week on', () => {
    expect(WARN_SPAN_HOURS).toBe(168);
    expect(resolveWindow({ hours: 720 }, now).spanHours).toBeGreaterThan(WARN_SPAN_HOURS);
    expect(resolveWindow({ hours: 168 }, now).spanHours).toBe(WARN_SPAN_HOURS);
  });
});

describe('planCellUndo', () => {
  const e = (ts: string, oldV: number | string | null, newV: number | string | null) =>
    ({ TimeStamp: ts, Cube: 'C', Tuple: ['a'], OldValue: oldV, NewValue: newV });

  it('walks the chain back from the current value, even inside one second', () => {
    // Measured: three changes of the same cell in the same second, from the server in arbitrary order.
    const rows = [e('t1', 12345, 459), e('t1', 459, 12345), e('t1', 459, 6789)];
    expect(planCellUndo(459, [rows[0], rows[1]])).toEqual({ target: 459, conflict: false });
    expect(planCellUndo(12345, [rows[1]])).toEqual({ target: 459, conflict: false });
  });

  it('flags a later change and falls back to the oldest selected old value', () => {
    expect(planCellUndo(510, [e('t2', 459, 9999), e('t1', 100, 459)])).toEqual({ target: 100, conflict: true });
  });

  it('does not let a match in an older row skip a newer non-matching one', () => {
    // Post-review 09-23 F1: 1 matches the older row, the newer 2→3 was skipped, the target was 2.
    expect(planCellUndo(1, [e('10:00', 0, 1), e('10:02', 2, 3)])).toEqual({ target: 0, conflict: true });
    expect(planCellUndo(1, [e('10:00', 0, 1), e('10:02', 1, 0)])).toEqual({ target: 0, conflict: true });
  });

  it('offers no target when the order of the oldest same-second rows is ambiguous', () => {
    // Value cycle within one second, followed by an unrelated change: which start? Do not guess.
    expect(planCellUndo(9, [e('t1', 0, 1), e('t1', 1, 0)])).toEqual({ target: undefined, conflict: true });
    // Unambiguous start within the second: 5→6→7.
    expect(planCellUndo(9, [e('t1', 6, 7), e('t1', 5, 6)])).toEqual({ target: 5, conflict: true });
  });

  it('treats empty and zero as the same numeric value', () => {
    expect(planCellUndo(0, [e('t1', 5, null)])).toEqual({ target: 5, conflict: false });
    expect(planCellUndo(7, [e('t1', null, 7)])).toEqual({ target: null, conflict: false });
    expect(sameCellValue(null, 0)).toBe(true);
    expect(sameCellValue('', 'x')).toBe(false);
  });

  it('writes empty as 0 for numbers and as empty string for text', () => {
    expect(undoWireValue(null, 7)).toBe(0);
    expect(undoWireValue(null, 'abc')).toBe('');
    expect(undoWireValue(12, 7)).toBe(12);
  });
});

describe('buildCellsReadMdx', () => {
  it('reads several cells of one cube in one set, escaped', () => {
    expect(buildCellsReadMdx('Pl]an', ['A', 'B'], [['x', 'y'], ['x', 'z]']])).toBe(
      'SELECT {([A].[x], [B].[y]), ([A].[x], [B].[z]]])} ON 0 FROM [Pl]]an]',
    );
  });

  it('refuses a coordinate that does not match the dimension count', () => {
    expect(buildCellsReadMdx('C', ['A', 'B'], [['x']])).toBeNull();
  });
});

describe('orderSameSecond', () => {
  const e = (ts: string, oldV: number | null, newV: number, cube = 'C') =>
    ({ TimeStamp: ts, Cube: cube, Tuple: ['a'], OldValue: oldV, NewValue: newV });

  it('orders a same-second pair by the value chain of the newer row', () => {
    // Measured: 500459->510 came from the server BEFORE 510->500459, but was the newer row.
    const newer = e('t9', 500459, 510);
    const older = e('t9', 510, 500459);
    const before = e('t8', 500459, 510);
    expect(orderSameSecond([older, newer, before])).toEqual([newer, older, before]);
  });

  it('uses the chain inside the group when no newer row exists', () => {
    const first = e('t1', 459, 6789);
    const second = e('t1', 6789, 459);
    // Both values occur in the group as OldValue — without a newer row, the server order stays.
    expect(orderSameSecond([first, second])).toEqual([first, second]);
    const a = e('t1', 1, 2);
    const b = e('t1', 2, 3);
    expect(orderSameSecond([a, b])).toEqual([b, a]);
  });

  it('leaves other cells and other seconds alone', () => {
    const rows = [e('t2', 1, 2), e('t2', 5, 6, 'D'), e('t1', 0, 1)];
    expect(orderSameSecond(rows)).toEqual(rows);
  });
});
