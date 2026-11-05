import { describe, it, expect } from 'vitest';
import { sortRows, filterRows, isPlaceholderText } from '../../../webviews/objectOverview/overviewSortPure';
import type { OverviewRow } from '../../../webviews/objectOverview/overviewTypes';

const rows: OverviewRow[] = [
  { id: 'b', isControl: false, cells: { name: 'b', n: 2 } },
  { id: '}Ctrl', isControl: true, cells: { name: '}Ctrl', n: 10 } },
  { id: 'a', isControl: false, cells: { name: 'a', n: 1 } },
];

describe('sortRows', () => {
  it('sorts text ascending', () => {
    expect(sortRows(rows, 'name', 1, 'text').map(r => r.id)).toEqual(['a', 'b', '}Ctrl']);
  });
  it('sorts number descending', () => {
    expect(sortRows(rows, 'n', -1, 'number').map(r => r.id)).toEqual(['}Ctrl', 'b', 'a']);
  });
  it('puts null values last regardless of direction', () => {
    const withNull: OverviewRow[] = [
      { id: 'x', isControl: false, cells: { n: null } },
      { id: 'y', isControl: false, cells: { n: 5 } },
    ];
    expect(sortRows(withNull, 'n', 1, 'number').map(r => r.id)).toEqual(['y', 'x']);
    expect(sortRows(withNull, 'n', -1, 'number').map(r => r.id)).toEqual(['y', 'x']);
  });
  it('puts a non-numeric placeholder in a number column last, not at zero', () => {
    // A failed lazy fetch writes "—" into a number column; Number('—') is NaN
    // and must not collapse to 0 (which would sort below every real count).
    const withDash: OverviewRow[] = [
      { id: 'zero', isControl: false, cells: { n: 0 } },
      { id: 'failed', isControl: false, cells: { n: '—' } },
      { id: 'five', isControl: false, cells: { n: 5 } },
    ];
    expect(sortRows(withDash, 'n', 1, 'number').map(r => r.id)).toEqual(['zero', 'five', 'failed']);
    expect(sortRows(withDash, 'n', -1, 'number').map(r => r.id)).toEqual(['five', 'zero', 'failed']);
  });
});

describe('sortRows with explicit sortValues', () => {
  // "1.02 GB" < "842 MB" as text — only the raw byte count sorts correctly.
  const ram: OverviewRow[] = [
    { id: 'gb', isControl: false, cells: { name: 'gb', ram: '1.02 GB' }, sortValues: { ram: 1095216660 } },
    { id: 'mb', isControl: false, cells: { name: 'mb', ram: '842 MB' }, sortValues: { ram: 882900992 } },
    { id: 'kb', isControl: false, cells: { name: 'kb', ram: '12.3 KB' }, sortValues: { ram: 12595 } },
  ];

  it('sorts a text column numerically by its sortValue', () => {
    expect(sortRows(ram, 'ram', 1, 'text').map(r => r.id)).toEqual(['kb', 'mb', 'gb']);
    expect(sortRows(ram, 'ram', -1, 'text').map(r => r.id)).toEqual(['gb', 'mb', 'kb']);
  });

  it('treats a row without a sortValue as null → last in both directions', () => {
    const mixed: OverviewRow[] = [
      ...ram,
      { id: 'none', isControl: false, cells: { name: 'none', ram: '—' } },
    ];
    expect(sortRows(mixed, 'ram', 1, 'text').map(r => r.id)).toEqual(['kb', 'mb', 'gb', 'none']);
    expect(sortRows(mixed, 'ram', -1, 'text').map(r => r.id)).toEqual(['gb', 'mb', 'kb', 'none']);
  });

  it('honours a sortValue of 0 instead of falling back to text order', () => {
    // 0 is the one value where a `!== undefined` check silently degrades into a
    // truthiness check: the column would then sort by the formatted label, and
    // "1.02 GB" sorts before "12.3 KB" as text.
    const withZero: OverviewRow[] = [
      ...ram,
      { id: 'empty', isControl: false, cells: { name: 'empty', ram: '0 B' }, sortValues: { ram: 0 } },
    ];
    expect(sortRows(withZero, 'ram', 1, 'text').map(r => r.id)).toEqual(['empty', 'kb', 'mb', 'gb']);
    expect(sortRows(withZero, 'ram', -1, 'text').map(r => r.id)).toEqual(['gb', 'mb', 'kb', 'empty']);
  });

  it('activates sortValue mode even when the only raw key is 0', () => {
    const onlyZero: OverviewRow[] = [
      { id: 'zero', isControl: false, cells: { name: 'zero', ram: '0 B' }, sortValues: { ram: 0 } },
      { id: 'none', isControl: false, cells: { name: 'none', ram: '999 GB' } },
    ];
    // "none" carries no raw key → last in BOTH directions; plain text order
    // would put "999 GB" first ascending.
    expect(sortRows(onlyZero, 'ram', 1, 'text').map(r => r.id)).toEqual(['zero', 'none']);
    expect(sortRows(onlyZero, 'ram', -1, 'text').map(r => r.id)).toEqual(['zero', 'none']);
  });

  it('ignores sortValues of other columns', () => {
    expect(sortRows(ram, 'name', 1, 'text').map(r => r.id)).toEqual(['gb', 'kb', 'mb']);
  });

  it('leaves plain text and plain number columns untouched', () => {
    expect(sortRows(rows, 'name', 1, 'text').map(r => r.id)).toEqual(['a', 'b', '}Ctrl']);
    expect(sortRows(rows, 'n', 1, 'number').map(r => r.id)).toEqual(['a', 'b', '}Ctrl']);
  });
});

describe('isPlaceholderText', () => {
  it('flags the values ICU would otherwise rank before real ones', () => {
    // '—'.localeCompare('21:00') === -1 — the reason the rule exists.
    expect('—'.localeCompare('21:00')).toBe(-1);
    expect(isPlaceholderText('—')).toBe(true);
    expect(isPlaceholderText('}Cubes')).toBe(true);
    expect(isPlaceholderText('21:00')).toBe(false);
    expect(isPlaceholderText('SingleCommit')).toBe(false);
    expect(isPlaceholderText('')).toBe(false);
  });
});

describe('filterRows', () => {
  it('hides control rows by default', () => {
    expect(filterRows(rows, '', false).map(r => r.id)).toEqual(['b', 'a']);
  });
  it('shows control rows when enabled', () => {
    expect(filterRows(rows, '', true).map(r => r.id)).toEqual(['b', '}Ctrl', 'a']);
  });
  it('filters by name case-insensitively', () => {
    expect(filterRows(rows, 'A', true).map(r => r.id)).toEqual(['a']);
  });
});
