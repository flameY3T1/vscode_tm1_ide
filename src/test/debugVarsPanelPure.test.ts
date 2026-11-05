import { describe, it, expect } from 'vitest';
import {
  filterVarsByName,
  diffChangedNames,
  clampWidth,
  snapshotOf,
  sortPinnedThenChanged,
  type DebugVariable,
} from '../webviewClient/processEditorMonaco/debugVarsPanelPure';

const vars: DebugVariable[] = [
  { name: 'vCount', value: 5 },
  { name: 'sName', value: 'Alpha' },
  { name: 'vTotal', value: '5' },
];

describe('filterVarsByName', () => {
  it('returns all on empty/whitespace query', () => {
    expect(filterVarsByName(vars, '')).toHaveLength(3);
    expect(filterVarsByName(vars, '   ')).toHaveLength(3);
  });
  it('substring-matches the name, case-insensitive', () => {
    expect(filterVarsByName(vars, 'v').map(v => v.name)).toEqual(['vCount', 'vTotal']);
    expect(filterVarsByName(vars, 'NAME').map(v => v.name)).toEqual(['sName']);
  });
  it('ignores the value when matching', () => {
    expect(filterVarsByName(vars, 'Alpha')).toHaveLength(0);
  });
  it('returns empty on no match', () => {
    expect(filterVarsByName(vars, 'zzz')).toHaveLength(0);
  });
});

describe('diffChangedNames', () => {
  it('flags changed values and new names, treats 5 and "5" as equal', () => {
    const prev = new Map<string, string>([
      ['vCount', '5'],
      ['sName', 'Alpha'],
    ]);
    const curr: DebugVariable[] = [
      { name: 'vCount', value: 5 },      // unchanged (String(5) === '5')
      { name: 'sName', value: 'Beta' },  // changed
      { name: 'vNew', value: 1 },        // new
    ];
    expect([...diffChangedNames(prev, curr)].sort()).toEqual(['sName', 'vNew']);
  });
  it('flags everything when prev is empty (caller suppresses first-stop highlight)', () => {
    // NOTE: an empty prev means every name is "new"; the render layer suppresses this.
    const changed = diffChangedNames(new Map(), vars);
    expect(changed.size).toBe(3);
  });
});

describe('snapshotOf', () => {
  it('maps name → String(value)', () => {
    const snap = snapshotOf(vars);
    expect(snap.get('vCount')).toBe('5');
    expect(snap.get('sName')).toBe('Alpha');
  });
});

describe('sortPinnedThenChanged', () => {
  it('pinned first, then changed, then the rest', () => {
    expect(sortPinnedThenChanged(vars, new Set(['vTotal']), new Set(['sName'])).map(v => v.name))
      .toEqual(['vTotal', 'sName', 'vCount']);
  });
  it('a pinned one stands in front, even when it has changed', () => {
    // Pinning and marking are two statements: the row does not slide back into
    // the group of changed ones just because it has changed.
    expect(sortPinnedThenChanged(vars, new Set(['vTotal']), new Set(['vTotal', 'sName'])).map(v => v.name))
      .toEqual(['vTotal', 'sName', 'vCount']);
  });
  it('without pinning it behaves as before: changed ones to the top', () => {
    expect(sortPinnedThenChanged(vars, new Set(), new Set(['sName', 'vTotal'])).map(v => v.name))
      .toEqual(['sName', 'vTotal', 'vCount']);
  });
  it('without anything the original order stays', () => {
    expect(sortPinnedThenChanged(vars, new Set(), new Set()).map(v => v.name))
      .toEqual(['vCount', 'sName', 'vTotal']);
  });
});

describe('clampWidth', () => {
  it('clamps below min, above max, passes through in range', () => {
    expect(clampWidth(100, 180, 600)).toBe(180);
    expect(clampWidth(999, 180, 600)).toBe(600);
    expect(clampWidth(300, 180, 600)).toBe(300);
  });
});
