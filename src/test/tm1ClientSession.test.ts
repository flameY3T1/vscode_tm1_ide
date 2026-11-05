import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _setSessionForTest, _getSessionForTest, _clearAllSessionsForTest, apiRequest, closeSession, closeAllSessions } from '../tm1Client';
import type { Tm1Config } from '../tm1Client';
import { _clearAuthFailed } from '../tm1Rest/transport/session';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { parseTm1SessionCookie } from '../tm1Rest/transport/auth';
import { _sessionCacheKey } from '../tm1Rest/transport/session';

describe('parseTm1SessionCookie', () => {
  it('returns undefined when no set-cookie header is present', () => {
    expect(parseTm1SessionCookie(undefined)).toBeUndefined();
    expect(parseTm1SessionCookie([])).toBeUndefined();
  });

  it('extracts TM1SessionId from a single Set-Cookie header', () => {
    const headers = ['TM1SessionId=abc123; Path=/; HttpOnly'];
    expect(parseTm1SessionCookie(headers)).toBe('TM1SessionId=abc123');
  });

  it('extracts TM1SessionId from an array of Set-Cookie headers', () => {
    const headers = [
      'foo=bar; Path=/',
      'TM1SessionId=xyz789; Path=/; HttpOnly; Secure',
      'baz=qux',
    ];
    expect(parseTm1SessionCookie(headers)).toBe('TM1SessionId=xyz789');
  });

  it('is case-insensitive on the cookie name (servers vary)', () => {
    const headers = ['tm1sessionid=lowercased; Path=/'];
    expect(parseTm1SessionCookie(headers)).toBe('tm1sessionid=lowercased');
  });

  it('falls back to paSession (PA as a Service sends no TM1SessionId)', () => {
    const headers = ['paSession=s%3Aabc.def; Path=/; HttpOnly; Secure; SameSite=None'];
    expect(parseTm1SessionCookie(headers)).toBe('paSession=s%3Aabc.def');
  });

  it('prefers TM1SessionId over paSession when both are set', () => {
    const headers = ['paSession=pa1; Path=/', 'TM1SessionId=tm1; Path=/'];
    expect(parseTm1SessionCookie(headers)).toBe('TM1SessionId=tm1');
  });

  it('returns undefined if no TM1SessionId cookie is present', () => {
    const headers = ['JSESSIONID=abc; Path=/'];
    expect(parseTm1SessionCookie(headers)).toBeUndefined();
  });
});

const cfgA: Tm1Config = {
  serverUrl: 'http://server-a:8010',
  username: 'admin',
  password: 'apple',
  rejectUnauthorized: false,
  authType: 'Basic',
};
const cfgB: Tm1Config = { ...cfgA, serverUrl: 'http://server-b:8010' };

describe('session cache key', () => {
  it('trailing slash on serverUrl does not change the key (normalization)', () => {
    const k1 = _sessionCacheKey(cfgA);
    const k2 = _sessionCacheKey({ ...cfgA, serverUrl: cfgA.serverUrl + '/' });
    expect(k1).toBe(k2);
  });

  it('different serverUrl → different key', () => {
    expect(_sessionCacheKey(cfgA)).not.toBe(_sessionCacheKey(cfgB));
  });

  it('different username → different key (two users on the same server must not share)', () => {
    const k1 = _sessionCacheKey(cfgA);
    const k2 = _sessionCacheKey({ ...cfgA, username: 'other' });
    expect(k1).not.toBe(k2);
  });

  it('different authType / camNamespace → different key', () => {
    const basicKey = _sessionCacheKey(cfgA);
    const camKey   = _sessionCacheKey({ ...cfgA, authType: 'CAM', camNamespace: 'LDAP' });
    expect(basicKey).not.toBe(camKey);
  });

  it('different password → different key (cross-profile cookie-bleed guard)', () => {
    // Same identity tuple, different secret: must NOT share a cache entry,
    // otherwise a wrong password rides the other profile's cached cookie.
    const k1 = _sessionCacheKey(cfgA);
    const k2 = _sessionCacheKey({ ...cfgA, password: 'banana' });
    expect(k1).not.toBe(k2);
  });

  it('key never leaks the plaintext password (only a hash fingerprint)', () => {
    expect(_sessionCacheKey(cfgA)).not.toContain(cfgA.password);
  });
});

describe('session cache get/set/clear', () => {
  beforeEach(() => _clearAllSessionsForTest());

  it('returns undefined when nothing is cached', () => {
    expect(_getSessionForTest(cfgA)).toBeUndefined();
  });

  it('stores and retrieves a cookie per config', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=aaa');
    _setSessionForTest(cfgB, 'TM1SessionId=bbb');
    expect(_getSessionForTest(cfgA)?.cookie).toBe('TM1SessionId=aaa');
    expect(_getSessionForTest(cfgB)?.cookie).toBe('TM1SessionId=bbb');
  });

  it('a cached session is NOT shared across differing passwords (no cross-profile bleed)', () => {
    // Cache a cookie for the correct password, then look it up with a wrong
    // password on the same identity tuple → must miss, not ride the cookie.
    _setSessionForTest(cfgA, 'TM1SessionId=RIGHT');
    expect(_getSessionForTest({ ...cfgA, password: 'wrong-pw' })).toBeUndefined();
    expect(_getSessionForTest(cfgA)?.cookie).toBe('TM1SessionId=RIGHT');
  });
});

function startFakeTm1(
  behavior: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(behavior);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe('request — session reuse integration', () => {
  beforeEach(() => _clearAllSessionsForTest());
  afterEach(() => _clearAllSessionsForTest());

  it('sends Basic on first call, captures TM1SessionId, reuses cookie on second call', async () => {
    const calls: Array<{ auth?: string; cookie?: string; path: string }> = [];
    const fake = await startFakeTm1((req, res) => {
      calls.push({
        auth:   req.headers['authorization'] as string | undefined,
        cookie: req.headers['cookie']        as string | undefined,
        path:   req.url ?? '',
      });
      if (!req.headers['cookie']) {
        res.setHeader('Set-Cookie', 'TM1SessionId=SESSION1; Path=/; HttpOnly');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ value: [] }));
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url,
      username:  'admin',
      password:  'apple',
      rejectUnauthorized: false,
      authType:  'Basic',
    };

    await apiRequest('GET', 'Processes?$select=Name', undefined, 5000, cfg);
    await apiRequest('GET', 'Cubes?$select=Name',     undefined, 5000, cfg);

    expect(calls).toHaveLength(2);
    expect(calls[0].auth).toMatch(/^Basic /);
    expect(calls[0].cookie).toBeUndefined();
    expect(calls[1].cookie).toBe('TM1SessionId=SESSION1');
    expect(calls[1].auth).toBeUndefined();
    expect(_getSessionForTest(cfg)?.cookie).toBe('TM1SessionId=SESSION1');

    await fake.close();
  });

  it('on 401 with cached cookie, invalidates and retries with Basic', async () => {
    let serverSessionId = 'VALID';
    const calls: Array<{ auth?: string; cookie?: string }> = [];
    const fake = await startFakeTm1((req, res) => {
      const cookie = req.headers['cookie'] as string | undefined;
      const auth   = req.headers['authorization'] as string | undefined;
      calls.push({ auth, cookie });

      if (cookie && !cookie.includes(serverSessionId)) {
        res.statusCode = 401;
        res.end('Session expired');
        return;
      }
      if (!cookie && auth?.startsWith('Basic ')) {
        serverSessionId = 'RENEWED';
        res.setHeader('Set-Cookie', `TM1SessionId=${serverSessionId}; Path=/`);
        res.statusCode = 200;
        res.end(JSON.stringify({ value: [] }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ value: [] }));
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };

    _setSessionForTest(cfg, 'TM1SessionId=STALE');
    const res = await apiRequest('GET', 'Processes?$select=Name', undefined, 5000, cfg);

    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].cookie).toBe('TM1SessionId=STALE');
    expect(calls[1].auth).toMatch(/^Basic /);
    expect(calls[1].cookie).toBeUndefined();
    expect(_getSessionForTest(cfg)?.cookie).toBe('TM1SessionId=RENEWED');

    await fake.close();
  });

  it('serializes concurrent first-calls so only one session is opened', async () => {
    // Without the init lock, a burst of N parallel first-calls each sees an
    // empty cache, sends Basic auth, and TM1 opens N sessions. With the lock
    // the leader's call opens the session, followers wait, all reuse the cookie.
    let basicCount = 0;
    let cookieCount = 0;
    const fake = await startFakeTm1((req, res) => {
      const cookie = req.headers['cookie'] as string | undefined;
      const auth = req.headers['authorization'] as string | undefined;
      if (cookie) { cookieCount++; }
      else if (auth?.startsWith('Basic ')) { basicCount++; }
      // Slow first response so followers stack up behind the leader.
      const delay = cookie ? 0 : 30;
      setTimeout(() => {
        if (!cookie) {
          res.setHeader('Set-Cookie', 'TM1SessionId=ONLY_ONE; Path=/; HttpOnly');
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ value: [] }));
      }, delay);
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };

    await Promise.all([
      apiRequest('GET', 'Processes?$select=Name', undefined, 5000, cfg),
      apiRequest('GET', 'Cubes?$select=Name', undefined, 5000, cfg),
      apiRequest('GET', 'Dimensions?$select=Name', undefined, 5000, cfg),
      apiRequest('GET', 'Threads', undefined, 5000, cfg),
    ]);

    expect(basicCount).toBe(1);
    expect(cookieCount).toBe(3);
    expect(_getSessionForTest(cfg)?.cookie).toBe('TM1SessionId=ONLY_ONE');

    await fake.close();
  });

  it('PATCH keeps the If-Match a caller sends and defaults to * otherwise', async () => {
    const seen: Array<string | undefined> = [];
    const fake = await startFakeTm1((req, res) => {
      if (req.method === 'PATCH') { seen.push(req.headers['if-match'] as string | undefined); }
      res.setHeader('Set-Cookie', 'TM1SessionId=S; Path=/');
      res.statusCode = 200;
      res.end('{}');
    });
    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };

    await apiRequest('PATCH', "Processes('P')", '{}', 5000, cfg, { 'If-Match': 'W/"abc"' });
    await apiRequest('PATCH', "Processes('P')", '{}', 5000, cfg);

    expect(seen).toEqual(['W/"abc"', '*']);
    await fake.close();
  });

  it('a late 401 for the old cookie keeps the session another request already re-minted', async () => {
    let serverSessionId = 'VALID';
    let staleSeen = 0;
    let basicLogins = 0;
    const fake = await startFakeTm1((req, res) => {
      const cookie = req.headers['cookie'] as string | undefined;
      const auth   = req.headers['authorization'] as string | undefined;
      if (!cookie && auth?.startsWith('Basic ')) {
        basicLogins++;
        serverSessionId = `RENEWED${basicLogins}`;
        res.setHeader('Set-Cookie', `TM1SessionId=${serverSessionId}; Path=/`);
        res.statusCode = 200;
        res.end(JSON.stringify({ value: [] }));
        return;
      }
      if (cookie && !cookie.includes(serverSessionId)) {
        // The second stale answer arrives only after the first one re-logged in.
        const deny = (): void => { res.statusCode = 401; res.end('Session expired'); };
        if (++staleSeen === 1) { deny(); return; }
        const t = setInterval(() => { if (basicLogins > 0) { clearInterval(t); deny(); } }, 5);
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ value: [] }));
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };

    _setSessionForTest(cfg, 'TM1SessionId=STALE');
    const [a, b] = await Promise.all([
      apiRequest('GET', 'Processes?$select=Name', undefined, 5000, cfg),
      apiRequest('GET', 'Cubes?$select=Name', undefined, 5000, cfg),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(basicLogins).toBe(1);
    expect(_getSessionForTest(cfg)?.cookie).toBe('TM1SessionId=RENEWED1');

    await fake.close();
  });

  // Review 2026-11-02: the browser branch dropped the session on any 401,
  // even when a login had replaced the rejected cookies meanwhile.
  it('browser login: a late 401 for replaced cookies keeps the fresh login', async () => {
    let releaseStale: (() => void) | undefined;
    const fake = await startFakeTm1((req, res) => {
      const cookie = req.headers['cookie'] as string | undefined;
      if (cookie?.includes('STALE')) {
        releaseStale = () => { res.statusCode = 401; res.end('expired'); };
        return;
      }
      res.statusCode = cookie?.includes('FRESH') ? 200 : 401;
      res.end(JSON.stringify({ value: [] }));
    });
    const cfg = {
      serverUrl: `${fake.url}/api/v1/tm1/Planning`, username: '', password: '',
      rejectUnauthorized: false, authType: 'browser',
    } as Tm1Config;

    _setSessionForTest(cfg, 'paSession=STALE');
    const late = apiRequest('GET', 'Cubes?$select=Name', undefined, 5000, cfg);
    await new Promise<void>(r => { const t = setInterval(() => { if (releaseStale) { clearInterval(t); r(); } }, 5); });
    _setSessionForTest(cfg, 'paSession=FRESH'); // the user logged in again
    releaseStale!();

    expect((await late).statusCode).toBe(200);
    expect(_getSessionForTest(cfg)?.cookie).toBe('paSession=FRESH');
    expect((await apiRequest('GET', 'Cubes?$select=Name', undefined, 5000, cfg)).statusCode).toBe(200);
    await fake.close();
  });

  // Review 2026-11-02: a renewed cookie from an old request overwrote the
  // session a concurrent request had re-minted.
  it('a renewed cookie on an old request does not overwrite a newer session', async () => {
    let releaseOld: (() => void) | undefined;
    const fake = await startFakeTm1((req, res) => {
      const cookie = req.headers['cookie'] as string | undefined;
      if (cookie?.includes('OLD')) {
        releaseOld = () => {
          res.setHeader('Set-Cookie', 'TM1SessionId=OLD-RENEWED; Path=/');
          res.statusCode = 200;
          res.end(JSON.stringify({ value: [] }));
        };
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ value: [] }));
    });
    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };

    _setSessionForTest(cfg, 'TM1SessionId=OLD');
    const old = apiRequest('GET', 'Cubes?$select=Name', undefined, 5000, cfg);
    await new Promise<void>(r => { const t = setInterval(() => { if (releaseOld) { clearInterval(t); r(); } }, 5); });
    _setSessionForTest(cfg, 'TM1SessionId=NEW');
    releaseOld!();
    await old;

    expect(_getSessionForTest(cfg)?.cookie).toBe('TM1SessionId=NEW');
    await fake.close();
  });

  it('does not retry when Basic auth itself returns 401 (avoids infinite loop)', async () => {
    const calls: unknown[] = [];
    const fake = await startFakeTm1((req, res) => {
      calls.push(1);
      res.statusCode = 401;
      res.end('Bad credentials');
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'wrong', password: 'wrong',
      rejectUnauthorized: false, authType: 'Basic',
    };

    const res = await apiRequest('GET', 'Processes?$select=Name', undefined, 5000, cfg);
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(1);

    await fake.close();
  });

  it('N concurrent first-calls with bad creds → ONE Basic-Auth attempt (no account-lockout amplification)', async () => {
    // P0-5 regression: prior to the fix, each waiter saw an empty cache
    // after `await inflight` and recursed into a fresh init attempt,
    // becoming the new lock-holder. With N=4 callers, the server received
    // 4 sequential Basic-Auth failures against the same account — a
    // textbook account-lockout trigger. The fix propagates the init
    // outcome via _initInflight; waiters short-circuit with synthetic 401
    // when the lock-holder hit 401, so only the lock-holder ever sends
    // Basic credentials to the server.
    let basicCount = 0;
    const fake = await startFakeTm1((req, res) => {
      const auth = req.headers['authorization'] as string | undefined;
      if (auth?.startsWith('Basic ')) { basicCount++; }
      // Slow first response so all 4 callers stack up behind the lock-holder.
      setTimeout(() => {
        res.statusCode = 401;
        res.end('Bad credentials');
      }, 30);
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'wrong', password: 'wrong',
      rejectUnauthorized: false, authType: 'Basic',
    };

    const results = await Promise.all([
      apiRequest('GET', 'Processes?$select=Name',  undefined, 5000, cfg),
      apiRequest('GET', 'Cubes?$select=Name',      undefined, 5000, cfg),
      apiRequest('GET', 'Dimensions?$select=Name', undefined, 5000, cfg),
      apiRequest('GET', 'Threads',                 undefined, 5000, cfg),
    ]);

    // All 4 callers see 401 …
    expect(results.every(r => r.statusCode === 401)).toBe(true);
    // … but the server only ever received ONE Basic-Auth attempt.
    expect(basicCount).toBe(1);

    await fake.close();
  });

  it('lock-holder 5xx does NOT short-circuit waiters (only 401 propagates as auth-failure)', async () => {
    // Defensive: the bad-creds short-circuit must be scoped to 401. A
    // transient server-side 5xx during init should let waiters fall
    // through to a retry attempt (existing behaviour — server might be
    // healthy on the next try).
    let attempt = 0;
    const fake = await startFakeTm1((req, res) => {
      attempt++;
      // First attempt: slow 503. Subsequent attempts succeed with a session.
      if (attempt === 1) {
        setTimeout(() => {
          res.statusCode = 503;
          res.end('temporary');
        }, 30);
        return;
      }
      if (!req.headers['cookie']) {
        res.setHeader('Set-Cookie', 'TM1SessionId=AFTER_5XX; Path=/; HttpOnly');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ value: [] }));
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };

    const results = await Promise.all([
      apiRequest('GET', 'Processes?$select=Name', undefined, 5000, cfg),
      apiRequest('GET', 'Cubes?$select=Name',     undefined, 5000, cfg),
    ]);

    // At least one of the callers must have retried past the 503 and
    // landed on the 200 path — i.e. the 503 was not silently propagated
    // to all waiters as a short-circuited auth failure.
    const okCount = results.filter(r => r.statusCode === 200).length;
    expect(okCount).toBeGreaterThan(0);
    // Server saw the 5xx attempt plus at least one retry.
    expect(attempt).toBeGreaterThanOrEqual(2);

    await fake.close();
  });

  it('arms negative-auth cache on 401: later calls fast-fail without re-hitting the server (lockout guard)', async () => {
    let attempts = 0;
    const fake = await startFakeTm1((req, res) => {
      attempts++;
      res.statusCode = 401;
      res.end('unauthorized');
    });
    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'wrong',
      rejectUnauthorized: false, authType: 'Basic',
    };

    // First call sends Basic, gets 401, arms the negative-auth cache.
    const r1 = await apiRequest('GET', 'Configuration', undefined, 5000, cfg);
    expect(r1.statusCode).toBe(401);
    expect(attempts).toBe(1);

    // Subsequent calls (other features) must NOT re-send credentials — they
    // short-circuit to a synthetic 401 so the TM1 account is never locked.
    const r2 = await apiRequest('GET', 'Cubes?$select=Name', undefined, 5000, cfg);
    const r3 = await apiRequest('GET', 'Dimensions?$select=Name', undefined, 5000, cfg);
    expect(r2.statusCode).toBe(401);
    expect(r3.statusCode).toBe(401);
    expect(attempts).toBe(1); // server saw exactly ONE login attempt total

    // Explicit reset (mirrors serverManager.connect re-try) re-enables auth.
    _clearAuthFailed(cfg);
    const r4 = await apiRequest('GET', 'Configuration', undefined, 5000, cfg);
    expect(r4.statusCode).toBe(401);
    expect(attempts).toBe(2);

    await fake.close();
  });
});

describe('closeSession', () => {
  beforeEach(() => _clearAllSessionsForTest());

  it('POSTs to /ActiveSession/tm1.Close with the cached cookie and clears the cache', async () => {
    const calls: Array<{ method?: string; path?: string; cookie?: string; auth?: string }> = [];
    const fake = await startFakeTm1((req, res) => {
      calls.push({
        method: req.method,
        path:   req.url,
        cookie: req.headers['cookie'] as string | undefined,
        auth:   req.headers['authorization'] as string | undefined,
      });
      res.statusCode = 204;
      res.end();
    });

    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };
    _setSessionForTest(cfg, 'TM1SessionId=ABC');

    await closeSession(cfg);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toContain('/ActiveSession/tm1.Close');
    expect(calls[0].cookie).toBe('TM1SessionId=ABC');
    expect(calls[0].auth).toBeUndefined();
    expect(_getSessionForTest(cfg)).toBeUndefined();

    await fake.close();
  });

  it('is a no-op when no session is cached', async () => {
    const cfg: Tm1Config = {
      serverUrl: 'http://127.0.0.1:1', username: 'x', password: 'y',
      rejectUnauthorized: false, authType: 'Basic',
    };
    await expect(closeSession(cfg)).resolves.toBeUndefined();
  });

  it('swallows network errors (best-effort) but still clears the cache', async () => {
    const cfg: Tm1Config = {
      serverUrl: 'http://127.0.0.1:1', // port 1 = refuses connection
      username: 'x', password: 'y', rejectUnauthorized: false, authType: 'Basic',
    };
    _setSessionForTest(cfg, 'TM1SessionId=ZZZ');
    await expect(closeSession(cfg)).resolves.toBeUndefined();
    expect(_getSessionForTest(cfg)).toBeUndefined();
  });

  it('waits for a request still in flight before closing (no re-login after close)', async () => {
    const order: string[] = [];
    let releaseDelete: () => void = () => {};
    const fake = await startFakeTm1((req, res) => {
      order.push(`${req.method} ${req.headers['cookie'] ?? 'basic'}`);
      if (req.method === 'DELETE') {
        releaseDelete = () => { res.statusCode = 204; res.end(); };
        return;
      }
      res.statusCode = 204;
      res.end();
    });
    const cfg: Tm1Config = {
      serverUrl: fake.url, username: 'admin', password: 'apple',
      rejectUnauthorized: false, authType: 'Basic',
    };
    _setSessionForTest(cfg, 'TM1SessionId=ABC');

    // A closing panel's cleanup, fired without await.
    const cleanup = apiRequest('DELETE', "Cubes('c')/Views('tmp')", undefined, 5000, cfg);
    await new Promise(r => setTimeout(r, 20));
    const closing = closeSession(cfg);
    await new Promise(r => setTimeout(r, 20));
    releaseDelete();
    await cleanup;
    await closing;

    expect(order).toEqual(['DELETE TM1SessionId=ABC', 'POST TM1SessionId=ABC']);
    await fake.close();
  });

  it('closeAllSessions closes every cached session', async () => {
    const closedFor: string[] = [];
    const fake = await startFakeTm1((req, res) => {
      closedFor.push(req.headers['cookie'] as string);
      res.statusCode = 204;
      res.end();
    });
    const cfgA: Tm1Config = { serverUrl: fake.url,        username: 'a', password: 'x', rejectUnauthorized: false, authType: 'Basic' };
    const cfgB: Tm1Config = { serverUrl: fake.url + '/x', username: 'b', password: 'x', rejectUnauthorized: false, authType: 'Basic' };
    _setSessionForTest(cfgA, 'TM1SessionId=A');
    _setSessionForTest(cfgB, 'TM1SessionId=B');

    await closeAllSessions();

    expect(closedFor.sort()).toEqual(['TM1SessionId=A', 'TM1SessionId=B']);
    expect(_getSessionForTest(cfgA)).toBeUndefined();
    expect(_getSessionForTest(cfgB)).toBeUndefined();

    await fake.close();
  });

  it('SessionEntry stores cfg snapshot with password stripped (no credential retention)', () => {
    const cfg: Tm1Config = {
      serverUrl: 'http://server-x:8010',
      username: 'admin',
      password: 'super-secret',
      rejectUnauthorized: true,
      authType: 'Basic',
    };
    _setSessionForTest(cfg, 'TM1SessionId=X');
    const entry = _getSessionForTest(cfg);
    expect(entry).toBeDefined();
    expect(entry!.cfg).toBeDefined();
    expect(entry!.cfg.password).toBe('');
    // other fields preserved — closeAllSessions needs them
    expect(entry!.cfg.serverUrl).toBe('http://server-x:8010');
    expect(entry!.cfg.username).toBe('admin');
    expect(entry!.cfg.authType).toBe('Basic');
    // S4: rejectUnauthorized must survive (was hardcoded false previously)
    expect(entry!.cfg.rejectUnauthorized).toBe(true);
  });

  it('closeAllSessions handles serverUrl containing the cache-key separator (T6)', async () => {
    // Previously: cache-key was split by '|', so a URL containing '|' broke
    // reconstruction. Now closeAllSessions reads cfg directly from the entry.
    const closedFor: string[] = [];
    const fake = await startFakeTm1((req, res) => {
      closedFor.push(req.headers['cookie'] as string);
      res.statusCode = 204;
      res.end();
    });
    const trickyCfg: Tm1Config = {
      serverUrl: fake.url + '/has|pipe',
      username: 'u|name',
      password: 'p',
      rejectUnauthorized: false,
      authType: 'Basic',
    };
    _setSessionForTest(trickyCfg, 'TM1SessionId=PIPE');

    await closeAllSessions();

    expect(closedFor).toContain('TM1SessionId=PIPE');
    expect(_getSessionForTest(trickyCfg)).toBeUndefined();

    await fake.close();
  });
});
