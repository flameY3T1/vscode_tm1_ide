import { describe, it, expect } from 'vitest';
import { v12AuthFailureMessage } from '../../commands/serverManager/probeConnection';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const s2s: Tm1Config = {
  serverUrl: 'http://gw:4444', username: 'CID', password: 'SEC', rejectUnauthorized: false,
  authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'Admin' },
};

// Measured 2026-10-30: all of these used to read "username or password is incorrect".
describe('v12AuthFailureMessage', () => {
  it('stays out of v11', () => {
    expect(v12AuthFailureMessage({ serverUrl: 'https://h', username: 'u', password: 'p', rejectUnauthorized: true }, { statusCode: 401, body: '' })).toBeUndefined();
  });

  it('names the instance on a refused mint (403) and keeps the gateway reason', () => {
    const m = v12AuthFailureMessage(s2s, {
      statusCode: 403, body: 'x', v12MintFailure: { status: 403, detail: 'Insufficient permissions on this resource.' },
    });
    expect(m).toContain('instance "tm1"');
    expect(m).toContain('(Insufficient permissions on this resource.)');
  });

  it('names the client credentials on a mint 401', () => {
    expect(v12AuthFailureMessage(s2s, { statusCode: 401, body: 'x', v12MintFailure: { status: 401 } })).toContain('App-Client ID or secret');
  });

  it('names TM1 user and database when the mint worked and the data call is refused', () => {
    const m = v12AuthFailureMessage(s2s, { statusCode: 403, body: '{"error":{"code":"278"}}' });
    expect(m).toContain('TM1 user "Admin"');
    expect(m).toContain('database "db"');
  });
});
