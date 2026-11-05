import { describe, it, expect } from 'vitest';
import { buildV12SessionRequest, parseV12SessionResult } from '../tm1Rest/transport/v12Session';
import type { Tm1Config } from '../tm1Rest/transport/types';

const s2s: Tm1Config = { serverUrl: 'http://gw:4444', username: 'CID', password: 'SEC', rejectUnauthorized: false, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' } };
const native: Tm1Config = { ...s2s, username: 'bob', password: 'pw', v12: { instance: 'tm1', database: 'db', authMode: 'basic-native' as const, tm1User: 'bob' } };

describe('buildV12SessionRequest', () => {
  it('s2s: Basic(appClientId:password) + {User} body at session url', () => {
    const r = buildV12SessionRequest(s2s);
    expect(r.url).toBe('http://gw:4444/tm1/auth/v1/session');
    expect(r.headers.Authorization).toBe('Basic ' + Buffer.from('CID:SEC').toString('base64'));
    expect(JSON.parse(r.body!)).toEqual({ User: 'admin' });
  });
  it('native: Basic(username:password)', () => {
    const r = buildV12SessionRequest(native);
    expect(r.headers.Authorization).toBe('Basic ' + Buffer.from('bob:pw').toString('base64'));
    expect(JSON.parse(r.body!)).toEqual({ User: 'bob' });
  });
});

describe('parseV12SessionResult', () => {
  it('201 + TM1SessionId cookie → ok', () => {
    const r = parseV12SessionResult(201, ['TM1SessionId=abc; Path=/; HttpOnly']);
    expect(r).toEqual({ ok: true, cookie: 'TM1SessionId=abc' });
  });
  it('201 but no cookie → error', () => {
    expect(parseV12SessionResult(201, undefined).ok).toBe(false);
  });
  it('403 in OAuth shape → the server reason is kept (wrong instance, measured 2026-10-30)', () => {
    const r = parseV12SessionResult(403, undefined, '{ "error": "invalid_client", "error_details": "Insufficient permissions on this resource." }');
    expect(r).toEqual({
      ok: false, status: 403,
      message: 'v12 session mint failed with HTTP 403: Insufficient permissions on this resource.',
      detail: 'Insufficient permissions on this resource.',
    });
  });
  it('401 → error with status', () => {
    const r = parseV12SessionResult(401, undefined);
    expect(r).toEqual({ ok: false, status: 401, message: expect.any(String) });
  });
});
