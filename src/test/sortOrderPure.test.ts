import { describe, it, expect } from 'vitest';
import { buildSetSortOrderTi, parseSortOrder } from '../tm1Rest/sortOrderPure';

// Cell values as measured on 11.8.02900.8 (2026-10-08): ByInput leaves the type
// empty and keeps a stale sense; ByHierarchy keeps a stale sense too.
describe('parseSortOrder', () => {
  it('empty cells = input order', () => {
    expect(parseSortOrder(['', '', '', ''])).toEqual({ elements: 'input', components: 'input' });
  });
  it('ByInput with a stale DESCENDING sense stays input', () => {
    expect(parseSortOrder(['', 'DESCENDING', '', 'ASCENDING'])).toEqual({ elements: 'input', components: 'input' });
  });
  it('ByHierarchy ignores the stale sense', () => {
    expect(parseSortOrder(['BYHIERARCHY', 'DESCENDING', '', '']).elements).toBe('hierarchy');
  });
  it('name and level with sense', () => {
    expect(parseSortOrder(['BYNAME', 'DESCENDING', 'BYNAME', 'ASCENDING']))
      .toEqual({ elements: 'name-desc', components: 'name-asc' });
    expect(parseSortOrder(['BYLEVEL', 'DESCENDING', '', '']).elements).toBe('level-desc');
    expect(parseSortOrder(['bylevel', 'ascending', null, undefined]).elements).toBe('level-asc');
  });
});

describe('buildSetSortOrderTi', () => {
  it('component pair first, element pair second (measured parameter order)', () => {
    expect(buildSetSortOrderTi('D', 'H', { elements: 'level-desc', components: 'name-asc' }))
      .toBe("HierarchySortOrder('D','H','ByName','Ascending','ByLevel','Descending');");
  });
  it('escapes quotes in names', () => {
    expect(buildSetSortOrderTi("O'Neil", 'H', { elements: 'input', components: 'input' }))
      .toContain("'O''Neil'");
  });
});
