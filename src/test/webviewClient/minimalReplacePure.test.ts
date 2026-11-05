import { describe, expect, it } from 'vitest';
import { minimalReplace } from '../../webviewClient/_shared/minimalReplacePure';

const apply = (s: string, r: { offset: number; length: number; text: string }) =>
  s.slice(0, r.offset) + r.text + s.slice(r.offset + r.length);

describe('minimalReplace', () => {
  it('is undefined for equal strings', () => {
    expect(minimalReplace('abc', 'abc')).toBeUndefined();
  });
  it('covers only the changed middle', () => {
    expect(minimalReplace('line1\nline2\n', 'line1\nLINE2\n')).toEqual({ offset: 6, length: 4, text: 'LINE' });
  });
  it('handles insert at start and delete at end', () => {
    expect(minimalReplace('b', 'ab')).toEqual({ offset: 0, length: 0, text: 'a' });
    expect(minimalReplace('ab', 'a')).toEqual({ offset: 1, length: 1, text: '' });
  });
  it('does not let prefix and suffix overlap on repeated characters', () => {
    const r = minimalReplace('aaa', 'aaaa')!;
    expect(apply('aaa', r)).toBe('aaaa');
    expect(r.length).toBe(0);
  });
  it('round-trips arbitrary pairs', () => {
    for (const [a, b] of [['', 'x'], ['x', ''], ['abcdef', 'abXYef'], ['\r\n', '\n']]) {
      expect(apply(a, minimalReplace(a, b) ?? { offset: 0, length: 0, text: '' })).toBe(b);
    }
  });
});
