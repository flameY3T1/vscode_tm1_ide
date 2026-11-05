import { describe, it, expect } from 'vitest';
import {
  addEntry, removeEntry, HistoryEntry, DEFAULT_CAP,
} from '../mdx/historyStore';

function mk(mdx: string, ts = Date.now()): HistoryEntry {
  return { mdx, timestamp: ts, elapsedMs: 10, rowCount: 1, colCount: 1 };
}

describe('addEntry', () => {
  it('adds entry to an empty list', () => {
    const result = addEntry([], mk('SELECT 1'));
    expect(result).toHaveLength(1);
    expect(result[0].mdx).toBe('SELECT 1');
  });

  it('new entries go to the front (most recent first)', () => {
    let list: HistoryEntry[] = [];
    list = addEntry(list, mk('A', 1));
    list = addEntry(list, mk('B', 2));
    list = addEntry(list, mk('C', 3));
    expect(list.map(e => e.mdx)).toEqual(['C', 'B', 'A']);
  });

  it('duplicate mdx bumps the existing entry to the top with new timestamp', () => {
    let list: HistoryEntry[] = [];
    list = addEntry(list, mk('X', 1));
    list = addEntry(list, mk('Y', 2));
    list = addEntry(list, mk('X', 3));
    expect(list.map(e => e.mdx)).toEqual(['X', 'Y']);
    expect(list[0].timestamp).toBe(3);
  });

  it('treats trimmed mdx as equal for de-duplication', () => {
    let list: HistoryEntry[] = [];
    list = addEntry(list, mk('SELECT 1', 1));
    list = addEntry(list, mk('  SELECT 1\n', 2));
    expect(list).toHaveLength(1);
    expect(list[0].timestamp).toBe(2);
  });

  it('enforces cap — oldest entries evicted when exceeded', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < DEFAULT_CAP + 10; i++) {
      list = addEntry(list, mk(`q${i}`, i));
    }
    expect(list).toHaveLength(DEFAULT_CAP);
    // Newest is q59 (when cap = 50, added 60 items: q50…q59 retained)
    expect(list[0].mdx).toBe(`q${DEFAULT_CAP + 9}`);
    expect(list[list.length - 1].mdx).toBe(`q10`);
  });

  it('custom cap is respected', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 5; i++) { list = addEntry(list, mk(`q${i}`, i), 3); }
    expect(list.map(e => e.mdx)).toEqual(['q4', 'q3', 'q2']);
  });

  it('preserves error field when present', () => {
    const entry: HistoryEntry = { mdx: 'bad', timestamp: 0, elapsedMs: 5, rowCount: 0, colCount: 0, error: { code: '501', message: 'Syntax' } };
    const list = addEntry([], entry);
    expect(list[0].error?.code).toBe('501');
  });
});

describe('removeEntry', () => {
  it('removes by index, returning new array', () => {
    const list: HistoryEntry[] = [mk('A', 1), mk('B', 2), mk('C', 3)];
    const result = removeEntry(list, 1);
    expect(result.map(e => e.mdx)).toEqual(['A', 'C']);
  });

  it('out-of-range index returns original list unchanged', () => {
    const list = [mk('A', 1)];
    expect(removeEntry(list, 5)).toEqual(list);
    expect(removeEntry(list, -1)).toEqual(list);
  });
});
