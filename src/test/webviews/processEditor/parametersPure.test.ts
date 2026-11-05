import { describe, it, expect } from 'vitest';
import {
  escapeAttr,
  moveItem,
  nextAutoName,
} from '../../../webviewClient/processEditorMonaco/parametersPure';

describe('escapeAttr', () => {
  it('escapes ampersand', () => {
    expect(escapeAttr('a & b')).toBe('a &amp; b');
  });

  it('escapes double quotes', () => {
    expect(escapeAttr('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeAttr("it's")).toBe('it&#039;s');
  });

  it('escapes angle brackets (MT2 consolidation: defense-in-depth)', () => {
    expect(escapeAttr('<x>')).toBe('&lt;x&gt;');
  });

  it('handles empty', () => {
    expect(escapeAttr('')).toBe('');
  });

  it('escapes & first to avoid double-escaping', () => {
    expect(escapeAttr('&quot;')).toBe('&amp;quot;');
  });
});

describe('nextAutoName', () => {
  it('returns pParam01 for empty list', () => {
    expect(nextAutoName(0)).toBe('pParam01');
  });

  it('zero-pads through 9', () => {
    expect(nextAutoName(0)).toBe('pParam01');
    expect(nextAutoName(8)).toBe('pParam09');
  });

  it('switches to unpadded at 10', () => {
    expect(nextAutoName(9)).toBe('pParam10');
    expect(nextAutoName(15)).toBe('pParam16');
  });

  it('handles large counts', () => {
    expect(nextAutoName(99)).toBe('pParam100');
  });
});

describe('moveItem', () => {
  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item down', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('moving the first item up is a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('moving the last item down is a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 3)).toEqual(['a', 'b', 'c']);
  });

  it('out-of-range source index is a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], -1, 0)).toEqual(['a', 'b', 'c']);
  });

  it('non-integer indices are a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], Number.NaN, 0)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1.5)).toEqual(['a', 'b', 'c']);
  });

  it('moving onto itself is a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    const out = moveItem(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(input);
    expect(out).toEqual(['b', 'c', 'a']);
  });

  it('keeps object identity of the moved entries (shallow copy)', () => {
    const a = { Name: 'a' };
    const b = { Name: 'b' };
    const out = moveItem([a, b], 1, 0);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
  });

  it('handles single-element and empty arrays', () => {
    expect(moveItem(['a'], 0, 1)).toEqual(['a']);
    expect(moveItem([] as string[], 0, 0)).toEqual([]);
  });
});
