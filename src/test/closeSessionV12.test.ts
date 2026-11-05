import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('../tm1Rest/transport/http', () => ({
  _rawRequest: (_m: string, url: string) => { calls.push(url); return Promise.resolve({ statusCode: 200, body: '' }); },
  assertOk: () => {},
  inFlightSettled: () => Promise.resolve(),
}));

import { closeSession, _setSessionForTest, _clearAllSessionsForTest } from '../tm1Client';
import type { Tm1Config } from '../tm1Client';

const v11: Tm1Config = { serverUrl: 'http://gw:4444', username: 'admin', password: '', rejectUnauthorized: false, authType: 'Basic' };
const v12: Tm1Config = { serverUrl: 'http://gw:4444', username: 'CID', password: 's', rejectUnauthorized: false, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' } };

beforeEach(() => {
  calls.length = 0;
  _clearAllSessionsForTest();
});

describe('closeSession URL branch', () => {
  it('v11 keeps /api/v1/ActiveSession/tm1.Close', async () => {
    _setSessionForTest(v11, 'TM1SessionId=abc');
    await closeSession(v11);
    expect(calls[0]).toBe('http://gw:4444/api/v1/ActiveSession/tm1.Close');
  });

  it('v12 uses Databases prefix for ActiveSession/tm1.Close', async () => {
    _setSessionForTest(v12, 'TM1SessionId=abc');
    await closeSession(v12);
    expect(calls[0]).toBe("http://gw:4444/tm1/api/v1/Databases('db')/ActiveSession/tm1.Close");
  });
});
