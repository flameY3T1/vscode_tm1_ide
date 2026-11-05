import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';

// The minting itself is done by `curl.exe` — replaced here by a double, so that
// the wiring test runs without Windows and without a domain.
const mint = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/transport/integratedSession', async (orig) => ({ ...(await orig<object>()), mintIntegratedCookie: mint }));

import { request } from '../../tm1Rest/transport/http';
import { _clearAllSessionsForTest, _clearAuthFailed } from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';

let server: http.Server;
let port = 0;
const seen: { cookie?: string; authorization?: string }[] = [];
let sessionValid = true;

beforeEach(async () => {
  _clearAllSessionsForTest();
  mint.mockReset();
  seen.length = 0;
  sessionValid = true;
  server = http.createServer((req, res) => {
    seen.push({ cookie: req.headers['cookie'] as string | undefined, authorization: req.headers['authorization'] as string | undefined });
    if (!sessionValid || req.headers['cookie'] !== 'TM1SessionId=good') {
      res.statusCode = 401; res.end(); return;
    }
    res.statusCode = 200; res.end('{"value":[]}');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => { server.close(); });

const agent = (): http.Agent => new http.Agent({ keepAlive: true });
function cfg(): Tm1Config {
  return {
    serverUrl: `http://127.0.0.1:${port}`, username: '', password: '',
    rejectUnauthorized: false, authType: 'integrated',
  };
}
const url = (): string => `http://127.0.0.1:${port}/api/v1/Cubes`;

describe('integrierte Anmeldung im Anfragefluss', () => {
  it('mints the cookie and then sends NO Authorization along', async () => {
    mint.mockResolvedValue({ ok: true, cookie: 'TM1SessionId=good', agent: agent() });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(200);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ cookie: 'TM1SessionId=good', authorization: undefined });
  });

  it('keeps using the cached cookie on the second request', async () => {
    mint.mockResolvedValue({ ok: true, cookie: 'TM1SessionId=good', agent: agent() });
    const c = cfg();
    await request('GET', url(), c);
    await request('GET', url(), c);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
  });

  it('re-mints exactly ONCE after a 401 on a cached cookie', async () => {
    mint
      .mockResolvedValueOnce({ ok: true, cookie: 'TM1SessionId=stale', agent: agent() })
      .mockResolvedValue({ ok: true, cookie: 'TM1SessionId=good', agent: agent() });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(200);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(seen.map(s => s.cookie)).toEqual(['TM1SessionId=stale', 'TM1SessionId=good']);
  });

  it('passes the rejected login through and does NOT try Basic', async () => {
    // The decisive point: no fallback to Basic. Every further attempt
    // counts as a failed login on the server — AD locks the account.
    mint.mockResolvedValue({ ok: false, status: 401, message: 'rejected' });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('stays silent after the rejected login (negative cache)', async () => {
    mint.mockResolvedValue({ ok: false, status: 401, message: 'rejected' });
    const c = cfg();
    await request('GET', url(), c);
    await request('GET', url(), c);
    expect(mint).toHaveBeenCalledTimes(1);
    _clearAuthFailed(c);
  });

  it('NEVER returns a failed minting attempt as 2xx', async () => {
    // Finding from the Codex review 2026-09-17 (3b): `minted.status` was passed through
    // unchanged. A server that answers the login with `200` without a cookie
    // therefore appeared as a successful data response — the
    // connection test reported success although no request ever ran.
    mint.mockResolvedValue({ ok: false, status: 200, message: 'accepted but no TM1SessionId cookie' });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode < 200 || res.statusCode >= 300).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('no TM1SessionId cookie');
    expect(seen).toHaveLength(0);
    _clearAuthFailed(cfg());
  });

  it('reports a missing Windows prerequisite as status 0, without network', async () => {
    mint.mockResolvedValue({ ok: false, status: 0, message: 'needs Windows' });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(0);
    expect(seen).toHaveLength(0);
    _clearAuthFailed(cfg());
  });

  it('does NOT mint again and again after status 0', async () => {
    // The expensive case: if an endpoint protection blocks `powershell.exe`,
    // the login never happens. Without the bolt, every further call runs
    // through the whole handshake again — three packets times three start attempts
    // are nine process starts PER call.
    mint.mockResolvedValue({
      ok: false, status: 0,
      message: 'Windows single sign-on could not start powershell.exe',
    });
    const first = await request('GET', url(), cfg());
    expect(first.statusCode).toBe(0);
    expect(mint).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 4; i += 1) { await request('GET', url(), cfg()); }
    expect(mint).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
    _clearAuthFailed(cfg());
  });

  it('reports the reason in the fast exit, not a bare 401', async () => {
    // `401` reads as "wrong password" — no credentials were ever
    // sent here.
    mint.mockResolvedValue({
      ok: false, status: 0,
      message: 'Windows single sign-on could not start powershell.exe',
    });
    await request('GET', url(), cfg());
    const again = await request('GET', url(), cfg());
    // The second response comes from the bolt, not from a second
    // minting — otherwise this test would check the same path as the first one.
    expect(mint).toHaveBeenCalledTimes(1);
    expect(again.statusCode).toBe(0);
    expect(again.body).toContain('could not start powershell.exe');
    _clearAuthFailed(cfg());
  });

  it('releases the bolt again on an explicit connect', async () => {
    mint.mockResolvedValue({ ok: false, status: 0, message: 'blocked' });
    await request('GET', url(), cfg());
    expect(mint).toHaveBeenCalledTimes(1);
    _clearAuthFailed(cfg());
    await request('GET', url(), cfg());
    expect(mint).toHaveBeenCalledTimes(2);
    _clearAuthFailed(cfg());
  });
});
