import { describe, it, expect } from 'vitest';
import { buildV12SessionRequest } from '../tm1Rest/transport/v12Session';
import type { Tm1Config } from '../tm1Rest/transport/types';

const native: Tm1Config = {
  serverUrl: 'http://gw:4444', username: 'bob', password: 'pw', rejectUnauthorized: false,
  authType: 'v12-basic', version: 'v12',
  v12: { instance: 'tm1', database: 'db', authMode: 'basic-native', tm1User: 'bob' },
};

describe('v12 basic-native', () => {
  it('uses username:password (no appClientId) for Basic and {User: bob}', () => {
    const r = buildV12SessionRequest(native);
    expect(r.headers.Authorization).toBe('Basic ' + Buffer.from('bob:pw').toString('base64'));
    expect(JSON.parse(r.body!)).toEqual({ User: 'bob' });
  });
});
