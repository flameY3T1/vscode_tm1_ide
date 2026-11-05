import { describe, it, expect } from 'vitest';
import { escapeAttr } from '../../../webviewClient/htmlUtils';

describe('variablesPure.escapeAttr', () => {
  it('escapes ampersand', () => {
    expect(escapeAttr('a & b')).toBe('a &amp; b');
  });

  it('escapes double quotes', () => {
    expect(escapeAttr('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeAttr("it's")).toBe('it&#039;s');
  });

  it('escapes angle brackets (broader than parametersPure)', () => {
    expect(escapeAttr('<x>')).toBe('&lt;x&gt;');
  });

  it('handles combined chars', () => {
    expect(escapeAttr(`<a "b" & 'c'>`))
      .toBe('&lt;a &quot;b&quot; &amp; &#039;c&#039;&gt;');
  });

  it('handles empty string', () => {
    expect(escapeAttr('')).toBe('');
  });

  it('escapes & first', () => {
    expect(escapeAttr('&lt;')).toBe('&amp;lt;');
  });
});
