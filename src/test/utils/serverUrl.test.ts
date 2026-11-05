import { describe, it, expect } from 'vitest';
import { validateServerUrl, isPlainHttpUrl, normalizeServerUrl } from '../../utils/serverUrl';

describe('validateServerUrl', () => {
  it.each([
    'https://localhost:8010',
    'https://tm1.example.com',
    'http://localhost:8010',
    'https://1.2.3.4:443/some/path',
  ])('accepts valid URL (%s)', (url) => {
    expect(validateServerUrl(url)).toBeNull();
  });

  it.each([
    ['', /empty/],
    ['   ', /empty/],
    ['not-a-url', /Invalid URL/],
    ['file:///etc/passwd', /Scheme/],
    ['ftp://host', /Scheme/],
    ['javascript:alert(1)', /Scheme/],
    ['ws://host', /Scheme/],
  ])('rejects invalid URL (%s)', (url, pattern) => {
    expect(validateServerUrl(url)).toMatch(pattern);
  });

  it('rejects URL with control characters', () => {
    expect(validateServerUrl('https://host\x00.com')).toMatch(/control characters/);
    expect(validateServerUrl('https://host\n.com')).toMatch(/control characters/);
  });

  it('rejects URL containing credentials (userinfo)', () => {
    expect(validateServerUrl('https://user:pass@host:8010')).toMatch(/credentials/);
    expect(validateServerUrl('https://user@host:8010')).toMatch(/credentials/);
  });

  it('rejects overlong URL (>512 chars)', () => {
    const long = 'https://host.com/' + 'a'.repeat(600);
    expect(validateServerUrl(long)).toMatch(/too long/);
  });

  it('trims whitespace before validating', () => {
    expect(validateServerUrl('  https://x  ')).toBeNull();
  });
});

describe('isPlainHttpUrl', () => {
  it('returns true for http://', () => {
    expect(isPlainHttpUrl('http://host:8010')).toBe(true);
  });

  it('returns false for https://', () => {
    expect(isPlainHttpUrl('https://host:8010')).toBe(false);
  });

  it('returns false for invalid URL', () => {
    expect(isPlainHttpUrl('garbage')).toBe(false);
  });
});

describe('normalizeServerUrl', () => {
  it('prepends https:// when no scheme is present', () => {
    expect(normalizeServerUrl('host:8010')).toBe('https://host:8010');
    expect(normalizeServerUrl('  host:8010  ')).toBe('https://host:8010');
  });
  it('keeps an explicit scheme', () => {
    expect(normalizeServerUrl('http://host:8010')).toBe('http://host:8010');
    expect(normalizeServerUrl('https://host:8010')).toBe('https://host:8010');
  });
  it('strips a single trailing slash', () => {
    expect(normalizeServerUrl('https://host:8010/')).toBe('https://host:8010');
  });
  it('leaves an empty string empty', () => {
    expect(normalizeServerUrl('   ')).toBe('');
  });
  it('strips userinfo (credentials) from the URL', () => {
    expect(normalizeServerUrl('https://user:pass@host:8010')).toBe('https://host:8010');
    expect(normalizeServerUrl('user@host:8010')).toBe('https://host:8010');
  });
  it('never eats the scheme separator on a bare scheme', () => {
    expect(normalizeServerUrl('https://')).toBe('https://');
    expect(normalizeServerUrl('http://')).toBe('http://');
  });
});
