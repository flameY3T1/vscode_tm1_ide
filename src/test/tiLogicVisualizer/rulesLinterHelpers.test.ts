import { describe, it, expect } from 'vitest';
import { endsSemicolon, neutralizeLine } from '../../tiLogicVisualizer/rulesLinter/helpers';

describe('endsSemicolon', () => {
  it('detects a plain trailing semicolon', () => {
    expect(endsSemicolon('x = 1;')).toBe(true);
  });

  it('ignores a trailing comment after the semicolon', () => {
    expect(endsSemicolon('x = 1; # done')).toBe(true);
  });

  it('returns false when there is no terminator', () => {
    expect(endsSemicolon("['Dim':'El']")).toBe(false);
  });

  it('does NOT treat a semicolon inside a string literal as terminator', () => {
    expect(endsSemicolon("x = 'a;b'")).toBe(false);
  });

  it('does NOT let a # inside a string literal hide the real trailing semicolon', () => {
    // regression: comment-strip must run AFTER string neutralization
    expect(endsSemicolon("x = 'a#b';")).toBe(true);
  });
});

describe('neutralizeLine', () => {
  it('replaces quoted strings with spaces', () => {
    expect(neutralizeLine("x = 'abc'")).toBe('x =      ');
  });

  it('strips trailing comments', () => {
    expect(neutralizeLine('x = 1 # note')).toBe('x = 1 ');
  });

  it('treats a # inside a string as string content, not a comment', () => {
    expect(neutralizeLine("x = 'a#b'")).toBe('x =      ');
  });
});
