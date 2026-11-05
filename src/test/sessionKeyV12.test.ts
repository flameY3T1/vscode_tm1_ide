import { describe, it, expect } from 'vitest';
import { _sessionCacheKey } from '../tm1Rest/transport/session';
import type { Tm1Config } from '../tm1Rest/transport/types';

const base = { serverUrl: 'http://gw:4444', username: 'CID', password: '', rejectUnauthorized: false, authType: 'v12-basic' as const, version: 'v12' as const };
const withDb = (db: string): Tm1Config => ({ ...base, v12: { instance: 'tm1', database: db, authMode: 'basic-s2s' as const, tm1User: 'admin' } });

describe('_sessionCacheKey v12', () => {
  it('two databases on the same gateway/user get distinct keys', () => {
    expect(_sessionCacheKey(withDb('db_a'))).not.toBe(_sessionCacheKey(withDb('db_b')));
  });
  it('same App-Client, different S2S target user or auth mode get distinct keys', () => {
    const cfg = (tm1User: string, authMode: 'basic-s2s' | 'basic-native' = 'basic-s2s'): Tm1Config =>
      ({ ...base, v12: { instance: 'tm1', database: 'db', authMode, tm1User } });
    expect(_sessionCacheKey(cfg('Admin'))).not.toBe(_sessionCacheKey(cfg('Reader')));
    expect(_sessionCacheKey(cfg('Admin'))).not.toBe(_sessionCacheKey(cfg('Admin', 'basic-native')));
  });
  it('v11 key has no instance/db segments, just the identity tuple + secret fingerprint', () => {
    const v11: Tm1Config = { serverUrl: 'https://h:8010', username: 'a', password: '', rejectUnauthorized: true, authType: 'Basic' };
    // …|Basic|<camNamespace=''>|<sha256(password).slice(0,16)>
    expect(_sessionCacheKey(v11)).toMatch(/^https:\/\/h:8010\|a\|Basic\|\|[0-9a-f]{16}$/);
  });
});
