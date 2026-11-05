import { describe, expect, it } from 'vitest';
import {
  browserCandidates, cookieHeader, cookiesForHost, nextLoginState,
} from '../../tm1Rest/transport/browserLoginPure';

function walk(urls: string[], origin: string): boolean[] {
  let state = { sawLogin: false };
  return urls.map(u => { const n = nextLoginState(state, u, origin); state = n; return n.done; });
}

describe('nextLoginState', () => {
  it('SaaS: done only after the round trip through IBMid (measured 2026-10-25)', () => {
    const origin = 'https://eu-central-1.planninganalytics.saas.ibm.com';
    expect(walk([
      'about:blank',
      `${origin}/`,
      'https://login.ibm.com/authsvc/mtfim/sps/authsvc',
      `${origin}/login`,
      `${origin}/`,
    ], origin)).toEqual([false, false, false, false, true]);
  });

  it('PAW Local: own login page on the same host (measured 2026-10-25)', () => {
    const origin = 'http://localhost:8080';
    expect(walk([`${origin}/login`, `${origin}/`], origin)).toEqual([false, true]);
  });

  it('never done while the page sits on the host without a login in between', () => {
    const origin = 'http://localhost:8080';
    expect(walk([`${origin}/`, `${origin}/ui`], origin)).toEqual([false, false]);
  });

  it('ignores the query when looking for a login path', () => {
    const origin = 'http://localhost:8080';
    expect(walk([`${origin}/login`, `${origin}/?next=/login`], origin)).toEqual([false, true]);
  });
});

describe('cookiesForHost', () => {
  const jar = [
    { name: 'paSession', value: 'a', domain: 'eu-central-1.planninganalytics.saas.ibm.com' },
    { name: '_abck', value: 'b', domain: '.ibm.com' },
    { name: 'idp', value: 'c', domain: 'login.ibm.com' },
    { name: 'other', value: 'd', domain: '.example.com' },
  ];

  it('keeps host-only and parent-domain cookies, drops other hosts', () => {
    expect(cookiesForHost(jar, 'eu-central-1.planninganalytics.saas.ibm.com').map(c => c.name))
      .toEqual(['paSession', '_abck']);
  });

  it('builds the Cookie header in jar order', () => {
    expect(cookieHeader(cookiesForHost(jar, 'eu-central-1.planninganalytics.saas.ibm.com')))
      .toBe('paSession=a; _abck=b');
  });

  it('does not match a host that merely ends with the domain text', () => {
    expect(cookiesForHost([{ name: 'x', value: '1', domain: '.ibm.com' }], 'notibm.com')).toEqual([]);
  });
});

describe('browserCandidates', () => {
  it('Windows: Edge before Chrome, skips unset roots', () => {
    const list = browserCandidates('win32', { ProgramFiles: 'C:\\Program Files' });
    expect(list).toEqual([
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]);
  });
});
