import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../../../utils/escapeRegexPure';
import { escapeHtml } from '../../../webviewClient/htmlUtils';
import { buildTiSkipMask } from '../../../webviewClient/_shared/tiSkipMask';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c+d?')).toBe('a\\.b\\*c\\+d\\?');
  });

  it('escapes brackets and braces', () => {
    expect(escapeRegex('[a]{b}(c)')).toBe('\\[a\\]\\{b\\}\\(c\\)');
  });

  it('escapes anchors and pipes', () => {
    expect(escapeRegex('^foo|bar$')).toBe('\\^foo\\|bar\\$');
  });

  it('escapes backslash', () => {
    expect(escapeRegex('a\\b')).toBe('a\\\\b');
  });

  it('preserves regular characters', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeRegex('')).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersand first', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < and >', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes quotes (MT2 consolidation: defense-in-depth)', () => {
    expect(escapeHtml(`"x" 'y'`)).toBe(`&quot;x&quot; &#039;y&#039;`);
  });

  it('handles mixed input', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });
});

describe('buildTiSkipMask', () => {
  it('returns all-false for plain text', () => {
    const mask = buildTiSkipMask('hello world');
    expect(mask).toEqual(new Array(11).fill(false));
  });

  it('masks single-quoted strings (incl. quotes)', () => {
    const line = "x = 'abc';";
    const mask = buildTiSkipMask(line);
    expect(mask[0]).toBe(false); // x
    expect(mask[4]).toBe(true);  // opening '
    expect(mask[5]).toBe(true);  // a
    expect(mask[6]).toBe(true);  // b
    expect(mask[7]).toBe(true);  // c
    expect(mask[8]).toBe(true);  // closing '
    expect(mask[9]).toBe(false); // ;
  });

  it('masks double-quoted strings (incl. quotes)', () => {
    const mask = buildTiSkipMask('a"bc"d');
    expect(mask).toEqual([false, true, true, true, true, false]);
  });

  it('masks # to end of line', () => {
    const mask = buildTiSkipMask('a # comment text');
    expect(mask[0]).toBe(false); // a
    expect(mask[1]).toBe(false); // space
    expect(mask[2]).toBe(true);  // #
    expect(mask[mask.length - 1]).toBe(true);
  });

  it('handles escaped single-quote `\'\'`', () => {
    const line = "'a''b'";
    const mask = buildTiSkipMask(line);
    expect(mask).toEqual([true, true, true, true, true, true]);
  });

  it('ignores # inside string literal', () => {
    const line = "'a#b'";
    const mask = buildTiSkipMask(line);
    expect(mask).toEqual([true, true, true, true, true]);
  });

  it('ignores quote in opposite quoting context', () => {
    const mask = buildTiSkipMask(`"a'b"`);
    expect(mask).toEqual([true, true, true, true, true]);
  });

  it('returns empty mask for empty string', () => {
    expect(buildTiSkipMask('')).toEqual([]);
  });

  it('handles unterminated string (mask continues to end)', () => {
    const mask = buildTiSkipMask("a 'unclosed");
    expect(mask[0]).toBe(false);
    expect(mask[2]).toBe(true);
    expect(mask[mask.length - 1]).toBe(true);
  });
});
