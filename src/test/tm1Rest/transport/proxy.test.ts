import { describe, it, expect } from 'vitest';
import { noProxyMatches, resolveProxy } from '../../../tm1Rest/transport/proxy';

describe('noProxyMatches', () => {
  const C: Array<[string, number, string[], boolean]> = [
    ['tm1.corp.com', 12345, ['corp.com'], true],
    ['tm1.corp.com', 12345, ['.corp.com'], true],
    ['tm1.corp.com', 12345, ['*.corp.com'], true],
    ['corp.com', 12345, ['corp.com'], true],
    ['tm1.corp.com', 12345, ['corp.com:12345'], true],
    ['tm1.corp.com', 9999, ['corp.com:12345'], false],
    ['other.com', 443, ['corp.com'], false],
    ['evilcorp.com', 443, ['corp.com'], false],
    ['127.0.0.1', 12345, [], true],
    ['localhost', 12345, [], true],
    ['::1', 12345, [], true],
    ['10.0.0.5', 8080, ['10.0.0.5'], true],
    ['tm1.corp.com', 12345, ['*'], true],
    ['tm1.corp.com', 12345, [''], false],
    ['TM1.CORP.COM', 12345, ['corp.com'], true],
    ['[::1]', 12345, [], true],                          // bracketed IPv6 loopback bypasses
    ['fe80::1', 8080, ['fe80::1'], true],                // bare IPv6 entry, exact match
    ['fe80::1', 8080, ['fe80::2'], false],               // different IPv6 -> no match
  ];
  it.each(C)('host=%s port=%s noProxy=%j -> %s', (h, p, np, expected) => {
    expect(noProxyMatches(h, p, np)).toBe(expected);
  });
});

describe('resolveProxy', () => {
  const T = 'https://tm1.corp.com:12345/api/v1';
  it('no config -> direct', () => {
    expect(resolveProxy(T, {}, {})).toEqual({ mode: 'direct', strictSSL: true });
  });
  it('http.proxy setting wins over env', () => {
    const d = resolveProxy(T, { HTTPS_PROXY: 'http://env:3128' }, { proxy: 'http://setting:8080' });
    expect(d).toMatchObject({ mode: 'proxy', proxyUrl: 'http://setting:8080' });
  });
  it('falls back HTTPS_PROXY then HTTP_PROXY', () => {
    expect(resolveProxy(T, { HTTP_PROXY: 'http://h:1' }, {})).toMatchObject({ mode: 'proxy', proxyUrl: 'http://h:1' });
    expect(resolveProxy(T, { HTTPS_PROXY: 'http://s:2', HTTP_PROXY: 'http://h:1' }, {})).toMatchObject({ proxyUrl: 'http://s:2' });
  });
  it('lowercase env vars honored', () => {
    expect(resolveProxy(T, { https_proxy: 'http://lc:9' }, {})).toMatchObject({ mode: 'proxy', proxyUrl: 'http://lc:9' });
  });
  it('strictSSL defaults true, respects false', () => {
    expect(resolveProxy(T, {}, { proxy: 'http://p:1' }).strictSSL).toBe(true);
    expect(resolveProxy(T, {}, { proxy: 'http://p:1', proxyStrictSSL: false }).strictSSL).toBe(false);
  });
  it('noProxy setting + NO_PROXY env both bypass', () => {
    expect(resolveProxy(T, { NO_PROXY: 'corp.com' }, { proxy: 'http://p:1' }).mode).toBe('direct');
    expect(resolveProxy(T, {}, { proxy: 'http://p:1', noProxy: ['corp.com'] }).mode).toBe('direct');
  });
});

describe('resolveProxy IPv6 + edge cases', () => {
  it('IPv6-literal target [::1] bypasses (always-bypass)', () => {
    expect(resolveProxy('https://[::1]:8080/api', {}, { proxy: 'http://p:3128' }).mode).toBe('direct');
  });
  it('noProxy is a union of settings + env (env entry alone matches)', () => {
    const d = resolveProxy('https://tm1.corp.com:12345/api', { NO_PROXY: 'corp.com' }, { proxy: 'http://p:1', noProxy: ['a.com'] });
    expect(d.mode).toBe('direct');
  });
  it('unparseable target URL fails open to direct', () => {
    expect(resolveProxy('not a url', {}, { proxy: 'http://p:1' })).toEqual({ mode: 'direct', strictSSL: true });
  });
});
