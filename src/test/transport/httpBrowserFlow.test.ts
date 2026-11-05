import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';

import { request } from '../../tm1Rest/transport/http';
import { _clearAllSessionsForTest, _clearAuthFailed, _getSession, _setSession } from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';

// Browser login (plan 2026-10-25, step 3): the session only ever comes from an
// explicit connect. The transport itself never logs in and never retries.

let server: http.Server;
let port = 0;
const seen: { method?: string; cookie?: string; authorization?: string; csrf?: string }[] = [];
let sessionValid = true;

beforeEach(async () => {
  _clearAllSessionsForTest();
  seen.length = 0;
  sessionValid = true;
  server = http.createServer((req, res) => {
    seen.push({
      method: req.method,
      cookie: req.headers['cookie'] as string | undefined,
      authorization: req.headers['authorization'] as string | undefined,
      csrf: req.headers['ba-sso-authenticity'] as string | undefined,
    });
    if (!sessionValid) { res.statusCode = 401; res.end(); return; }
    res.statusCode = 200; res.end('{"Name":"u"}');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => { server.close(); });

function cfg(): Tm1Config {
  return {
    serverUrl: `http://127.0.0.1:${port}/api/v1/tm1/inst`, username: '', password: '',
    rejectUnauthorized: false, authType: 'browser',
  };
}
const url = (): string => `http://127.0.0.1:${port}/api/v1/tm1/inst/api/v1/ActiveUser`;
const login = (c: Tm1Config): void =>
  _setSession(c, { cookie: 'paSession=p; ba-sso-csrf=x', agent: new http.Agent({ keepAlive: true }), cfg: c, lastUsed: Date.now() });

describe('browser login in the request flow', () => {
  it('without a session: 401 and no network at all', async () => {
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatch(/not logged in/i);
    expect(seen).toHaveLength(0);
  });

  it('with a session: sends the browser cookies, never Authorization, echoes CSRF on writes', async () => {
    const c = cfg();
    login(c);
    expect((await request('GET', url(), c)).statusCode).toBe(200);
    expect((await request('POST', url(), c, '{}')).statusCode).toBe(200);
    expect(seen).toEqual([
      { method: 'GET', cookie: 'paSession=p; ba-sso-csrf=x', authorization: undefined, csrf: 'x' },
      { method: 'POST', cookie: 'paSession=p; ba-sso-csrf=x', authorization: undefined, csrf: 'x' },
    ]);
  });

  it('expired session: one 401, then fast-fail without network until the next connect', async () => {
    const c = cfg();
    login(c);
    sessionValid = false;
    const first = await request('GET', url(), c);
    expect(first.statusCode).toBe(401);
    expect(first.body).toMatch(/expired/i);
    expect(seen).toHaveLength(1);

    const again = await request('GET', url(), c);
    expect(again.statusCode).toBe(401);
    expect(again.body).toMatch(/expired/i);
    expect(seen).toHaveLength(1);

    // Connect clears the guard and sets a fresh session.
    _clearAuthFailed(c);
    sessionValid = true;
    login(c);
    expect((await request('GET', url(), c)).statusCode).toBe(200);
    expect(seen).toHaveLength(2);
  });

  it('expired session also drops the other databases on the same host (shared cookies)', async () => {
    const c = cfg();
    const sibling: Tm1Config = { ...c, serverUrl: `http://127.0.0.1:${port}/api/v1/tm1/other` };
    login(c);
    login(sibling);
    sessionValid = false;
    expect((await request('GET', url(), c)).statusCode).toBe(401);
    expect(_getSession(sibling)).toBeUndefined();
  });
});
