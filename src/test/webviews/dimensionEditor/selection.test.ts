import { describe, it, expect } from 'vitest';
import { toggleSelection, computeRange } from '../../../webviewClient/dimensionEditor/pure';

describe('toggleSelection', () => {
  it('adds a missing name', () => {
    const s = new Set<string>(['a']);
    toggleSelection(s, 'b');
    expect([...s].sort()).toEqual(['a', 'b']);
  });
  it('removes a present name', () => {
    const s = new Set<string>(['a', 'b']);
    toggleSelection(s, 'b');
    expect([...s]).toEqual(['a']);
  });
  it('returns the same set instance', () => {
    const s = new Set<string>();
    expect(toggleSelection(s, 'x')).toBe(s);
  });
});

describe('computeRange', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('selects an inclusive forward range', () => {
    expect(computeRange(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
  });
  it('selects an inclusive reverse range (anchor after target)', () => {
    expect(computeRange(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });
  it('anchor === target returns just that name', () => {
    expect(computeRange(order, 'c', 'c')).toEqual(['c']);
  });
  it('missing anchor degrades to [target]', () => {
    expect(computeRange(order, 'zzz', 'c')).toEqual(['c']);
  });
  it('missing target degrades to [target]', () => {
    expect(computeRange(order, 'a', 'zzz')).toEqual(['zzz']);
  });
  it('uses first index for duplicate names', () => {
    expect(computeRange(['a', 'b', 'a', 'c'], 'a', 'c')).toEqual(['a', 'b', 'a', 'c']);
  });
});
