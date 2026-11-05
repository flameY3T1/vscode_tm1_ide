import { describe, it, expect } from 'vitest';
import { _sessionCacheKey } from '../tm1Rest/transport/session';
import { buildHeaders } from '../tm1Rest/transport/auth';
import type { Tm1Config } from '../tm1Rest/transport/types';

const admin: Tm1Config = {
  serverUrl: 'https://h:8010', username: 'admin', password: 'pw',
  rejectUnauthorized: true, authType: 'Basic',
};
const asOther: Tm1Config = { ...admin, impersonate: 'ReadOnlyUser' };

describe('Impersonation in the transport', () => {
  it('an impersonated view gets a session key of its OWN', () => {
    // Otherwise the cache would pick up the own user's entry, the request would
    // run over that user's cookie — and the user would keep seeing their own
    // rights without anything failing.
    expect(_sessionCacheKey(asOther)).not.toBe(_sessionCacheKey(admin));
  });

  it('two impersonated users do not share a session', () => {
    expect(_sessionCacheKey(asOther)).not.toBe(_sessionCacheKey({ ...admin, impersonate: 'Other' }));
  });

  it('sends the header ALSO on a request with a cookie', () => {
    // If only the login carried the header and TM1, contrary to expectation,
    // evaluated it per request, every follow-up request would silently return
    // the administrator's data.
    const headers = buildHeaders(asOther, undefined, undefined, 'TM1SessionId=abc');
    expect(headers['TM1-Impersonate']).toBe('ReadOnlyUser');
    expect(headers['Cookie']).toBe('TM1SessionId=abc');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('without impersonation the header is not in the request', () => {
    expect(buildHeaders(admin)['TM1-Impersonate']).toBeUndefined();
  });
});
