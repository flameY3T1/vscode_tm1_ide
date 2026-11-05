import { describe, it, expect } from 'vitest';
import {
  esc,
  computeDragNames,
} from '../../../webviewClient/dimensionBrowser/pure';

describe('esc', () => {
  it('encodes &, <, >, "', () => {
    expect(esc('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });
  it('returns empty string for null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
  it('coerces non-string input', () => {
    expect(esc(42)).toBe('42');
    expect(esc(true)).toBe('true');
  });
  it('passes through safe input', () => {
    expect(esc('PlainName_2024')).toBe('PlainName_2024');
  });
});

describe('computeDragNames', () => {
  it('returns just clicked name when no marks', () => {
    expect(computeDragNames('A', [])).toEqual(['A']);
  });
  it('returns just clicked name when single mark and clicked is NOT marked', () => {
    expect(computeDragNames('B', ['A'])).toEqual(['B']);
  });
  it('returns just clicked name when single mark equals clicked (snapshot would be redundant)', () => {
    expect(computeDragNames('A', ['A'])).toEqual(['A']);
  });
  it('returns the mark-set snapshot when clicked is in marks AND marks.length > 1', () => {
    const marks = ['A', 'B', 'C'];
    const result = computeDragNames('A', marks);
    expect(result).toEqual(marks);
    expect(result).not.toBe(marks); // slice() snapshot, not same ref
  });
  it('returns just clicked name when clicked is NOT in marks even with many marks', () => {
    expect(computeDragNames('X', ['A', 'B', 'C'])).toEqual(['X']);
  });
});
