import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { buildAuth, buildHeaders, EXT_CLIENT_ID } from '../../tm1Rest/transport/auth';
import { assertOk, request } from '../../tm1Rest/transport/http';
import {
  _setSessionForTest,
  _getSessionForTest,
  _clearAllSessionsForTest,
  _invalidateSession,
  _getOrCreateAgent,
  _allSessions,
  _markAuthFailed,
  _isAuthFailed,
  _clearAuthFailed,
} from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const basicCfg: Tm1Config = {
  serverUrl: 'http://srv:8010',
  username: 'admin',
  password: 'apple',
  rejectUnauthorized: false,
  authType: 'Basic',
};
const camCfg: Tm1Config = {
  ...basicCfg,
  authType: 'CAM',
  camNamespace: 'LDAP',
};

describe('buildAuth', () => {
  it('Basic → "Basic " + base64(user:password)', () => {
    const expected = 'Basic ' + Buffer.from('admin:apple').toString('base64');
    expect(buildAuth(basicCfg)).toBe(expected);
  });

  it('CAM → "CAMNamespace " + base64(user:password:namespace)', () => {
    const expected = 'CAMNamespace ' + Buffer.from('admin:apple:LDAP').toString('base64');
    expect(buildAuth(camCfg)).toBe(expected);
  });

  // (removed) 'CAM without namespace → trailing empty namespace segment':
  // this state is no longer representable. The Tm1Auth discriminated union
  // requires `camNamespace: string` on the CAM branch, so buildAuth can never
  // receive the old `user:pass:` (empty-segment) input from typed code. The
  // compile-time proof lives in src/tm1Rest/transport/authAssertions.ts
  // (_CamNoNamespace).

  it('missing authType defaults to Basic', () => {
    const cfg = { ...basicCfg, authType: undefined };
    expect(buildAuth(cfg)).toMatch(/^Basic /);
  });
});

describe('EXT_CLIENT_ID', () => {
  it('has the form vscode-tm1-ide/<version>', () => {
    expect(EXT_CLIENT_ID).toMatch(/^vscode-tm1-ide\/.+/);
  });
});

describe('buildHeaders', () => {
  it('sets the JSON content-type, accept and User-Agent baseline', () => {
    const h = buildHeaders(basicCfg);
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Accept']).toBe('application/json');
    expect(h['User-Agent']).toBe(EXT_CLIENT_ID);
  });

  it('without a cookie sends Authorization and no Cookie', () => {
    const h = buildHeaders(basicCfg);
    expect(h['Authorization']).toBe(buildAuth(basicCfg));
    expect(h['Cookie']).toBeUndefined();
  });

  it('with a cookie sends Cookie and omits Authorization (no fresh-session trigger)', () => {
    const h = buildHeaders(basicCfg, undefined, undefined, 'TM1SessionId=abc');
    expect(h['Cookie']).toBe('TM1SessionId=abc');
    expect(h['Authorization']).toBeUndefined();
  });

  it('Basic → TM1-SessionContext is the plain client id', () => {
    const h = buildHeaders(basicCfg);
    expect(h['TM1-SessionContext']).toBe(EXT_CLIENT_ID);
    expect(h['TM1-Session-Context']).toBe(EXT_CLIENT_ID);
  });

  it('CAM with namespace → TM1-SessionContext stays the plain client id', () => {
    const h = buildHeaders(camCfg);
    expect(h['TM1-SessionContext']).toBe(EXT_CLIENT_ID);
    expect(h['TM1-Session-Context']).toBe(EXT_CLIENT_ID);
  });

  it('CAM without namespace falls back to the plain client id', () => {
    // Deliberately invalid combo (CAM without namespace) — union forbids it, runtime must fall back.
    const h = buildHeaders({ ...basicCfg, authType: 'CAM' } as unknown as Parameters<typeof buildHeaders>[0]);
    expect(h['TM1-SessionContext']).toBe(EXT_CLIENT_ID);
  });

  it('sets Content-Length from the byte length of a string body', () => {
    const body = 'äöü'; // multibyte → byteLength != length
    const h = buildHeaders(basicCfg, body);
    expect(h['Content-Length']).toBe(Buffer.byteLength(body));
  });

  it('sets Content-Length from a Buffer body', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const h = buildHeaders(basicCfg, buf);
    expect(h['Content-Length']).toBe(5);
  });

  it('omits Content-Length when there is no body', () => {
    expect(buildHeaders(basicCfg)['Content-Length']).toBeUndefined();
  });

  it('merges extraHeaders; Authorization still wins over a clashing extra', () => {
    const h = buildHeaders(basicCfg, undefined, { 'X-Custom': 'v', Authorization: 'overwritten' });
    expect(h['X-Custom']).toBe('v');
    expect(h['Authorization']).toBe(buildAuth(basicCfg));
  });
});

describe('assertOk', () => {
  it('passes for 2xx statuses', () => {
    expect(() => assertOk({ statusCode: 200, body: '' })).not.toThrow();
    expect(() => assertOk({ statusCode: 204, body: '' })).not.toThrow();
    expect(() => assertOk({ statusCode: 299, body: '' })).not.toThrow();
  });

  it('throws on non-2xx with the status code in the message', () => {
    expect(() => assertOk({ statusCode: 500, body: 'boom' }))
      .toThrow(/HTTP 500/);
  });

  it('extracts error.message when it is a string', () => {
    const body = JSON.stringify({ error: { message: 'bad request detail' } });
    expect(() => assertOk({ statusCode: 400, body }))
      .toThrow(/bad request detail/);
  });

  it('extracts error.message.value when message is an object', () => {
    const body = JSON.stringify({ error: { message: { value: 'nested detail' } } });
    expect(() => assertOk({ statusCode: 400, body }))
      .toThrow(/nested detail/);
  });

  it('falls back to the raw body when it is not JSON', () => {
    expect(() => assertOk({ statusCode: 404, body: 'plain text error' }))
      .toThrow(/plain text error/);
  });

  it('prepends the context prefix', () => {
    expect(() => assertOk({ statusCode: 400, body: 'x' }, 'PATCH failed'))
      .toThrow(/^PATCH failed: HTTP 400/);
  });
});

describe('session cache internals', () => {
  beforeEach(() => _clearAllSessionsForTest());
  afterEach(() => _clearAllSessionsForTest());

  it('_invalidateSession removes the cached entry', () => {
    _setSessionForTest(basicCfg, 'TM1SessionId=x');
    expect(_getSessionForTest(basicCfg)).toBeDefined();
    _invalidateSession(basicCfg);
    expect(_getSessionForTest(basicCfg)).toBeUndefined();
  });

  it('_invalidateSession is a no-op for an uncached config', () => {
    expect(() => _invalidateSession(basicCfg)).not.toThrow();
  });

  it('_getOrCreateAgent reuses the cached agent when a session exists', () => {
    _setSessionForTest(basicCfg, 'TM1SessionId=x');
    const cached = _getSessionForTest(basicCfg)!.agent;
    expect(_getOrCreateAgent(basicCfg, false)).toBe(cached);
  });

  it('_getOrCreateAgent creates a fresh keep-alive agent when none is cached', () => {
    const agent = _getOrCreateAgent(basicCfg, false);
    expect(agent).toBeInstanceOf(http.Agent);
    expect((agent as unknown as { keepAlive: boolean }).keepAlive).toBe(true);
    agent.destroy();
  });

  it('_allSessions returns a snapshot of cached entries', () => {
    const cfgB: Tm1Config = { ...basicCfg, serverUrl: 'http://other:8010' };
    _setSessionForTest(basicCfg, 'TM1SessionId=a');
    _setSessionForTest(cfgB, 'TM1SessionId=b');
    const cookies = _allSessions().map((e) => e.cookie).sort();
    expect(cookies).toEqual(['TM1SessionId=a', 'TM1SessionId=b']);
  });
});

describe('negative-auth cache', () => {
  afterEach(() => _clearAuthFailed(basicCfg));

  it('arm / query / clear round-trip', () => {
    expect(_isAuthFailed(basicCfg)).toBe(false);
    _markAuthFailed(basicCfg);
    expect(_isAuthFailed(basicCfg)).toBe(true);
    _clearAuthFailed(basicCfg);
    expect(_isAuthFailed(basicCfg)).toBe(false);
  });

  it('is keyed per config (other server not affected)', () => {
    const cfgB: Tm1Config = { ...basicCfg, serverUrl: 'http://other:8010' };
    _markAuthFailed(basicCfg);
    expect(_isAuthFailed(cfgB)).toBe(false);
    _clearAuthFailed(basicCfg);
  });
});

function startFakeTm1(
  behavior: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(behavior);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe('request — PATCH sets If-Match: * (TM1 REST quirk)', () => {
  beforeEach(() => _clearAllSessionsForTest());
  afterEach(() => _clearAllSessionsForTest());

  it('adds the If-Match: * header on PATCH only', async () => {
    const seen: Array<{ method?: string; ifMatch?: string }> = [];
    const fake = await startFakeTm1((req, res) => {
      seen.push({ method: req.method, ifMatch: req.headers['if-match'] as string | undefined });
      if (!req.headers['cookie']) {
        res.setHeader('Set-Cookie', 'TM1SessionId=S; Path=/');
      }
      res.statusCode = 200;
      res.end('{}');
    });
    const cfg: Tm1Config = { ...basicCfg, serverUrl: fake.url };

    await request('PATCH', `${fake.url}/api/v1/Cubes('x')`, cfg, '{"Rules":""}', 5000);
    await request('GET', `${fake.url}/api/v1/Cubes?$select=Name`, cfg, undefined, 5000);

    const patch = seen.find((s) => s.method === 'PATCH');
    const get = seen.find((s) => s.method === 'GET');
    expect(patch?.ifMatch).toBe('*');
    expect(get?.ifMatch).toBeUndefined();

    await fake.close();
  });
});
