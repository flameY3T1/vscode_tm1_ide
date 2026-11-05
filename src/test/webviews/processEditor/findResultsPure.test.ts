import { describe, it, expect } from 'vitest';
import { buildSnippet } from '../../../webviewClient/_shared/findSnippet';

describe('buildSnippet', () => {
  it('splits a line into before/match/after around a mid-line match', () => {
    const line = 'sVal = CellGetN( cube, x );';
    // 'cube' starts at column 18 (1-based), length 4
    const col = line.indexOf('cube') + 1;
    const parts = buildSnippet(line, col, 4);
    expect(parts.match).toBe('cube');
    expect(parts.before).toBe('sVal = CellGetN( ');
    expect(parts.after).toBe(', x );');
    expect(parts.truncatedLeft).toBe(false);
    expect(parts.truncatedRight).toBe(false);
  });

  it('drops leading indentation from the before part', () => {
    const line = '    \t oldCube';
    const col = line.indexOf('oldCube') + 1;
    const parts = buildSnippet(line, col, 7);
    expect(parts.before).toBe('');
    expect(parts.match).toBe('oldCube');
  });

  it('handles a match at column 1 with empty before', () => {
    const parts = buildSnippet('cube = 1;', 1, 4);
    expect(parts.before).toBe('');
    expect(parts.match).toBe('cube');
    expect(parts.after).toBe(' = 1;');
  });

  it('clips an over-long before from the left and flags it', () => {
    const prefix = 'x'.repeat(100);
    const parts = buildSnippet(prefix + 'HIT', 101, 3, 40);
    expect(parts.truncatedLeft).toBe(true);
    expect(parts.before.length).toBe(40);
    expect(parts.before).toBe('x'.repeat(40));
    expect(parts.match).toBe('HIT');
  });

  it('clips an over-long after from the right and flags it', () => {
    const suffix = 'y'.repeat(200);
    const parts = buildSnippet('HIT' + suffix, 1, 3, 40, 80);
    expect(parts.truncatedRight).toBe(true);
    expect(parts.after.length).toBe(80);
  });

  it('never throws when the match runs past the end of the line', () => {
    const parts = buildSnippet('abc', 2, 999);
    expect(parts.match).toBe('bc');
    expect(parts.after).toBe('');
  });
});
