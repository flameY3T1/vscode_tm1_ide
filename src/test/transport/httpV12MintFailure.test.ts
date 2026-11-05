import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';

// Review 2026-10-03, A1: the v12 branch passed `minted.status` straight
// through. A gateway answering the mint with `2xx` but no TM1SessionId
// reached the caller as HTTP 200 with an empty body — the connection test
// reported success, and every later `parseBody` failed without a reason.
const mint = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/transport/v12Session', async (orig) => ({ ...(await orig<object>()), mintV12Cookie: mint }));

import { request } from '../../tm1Rest/transport/http';
import { _clearAllSessionsForTest, _clearAuthFailed } from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';

let server: http.Server;
let port = 0;
let hits = 0;

beforeEach(async () => {
  _clearAllSessionsForTest();
  mint.mockReset();
  hits = 0;
  server = http.createServer((req, res) => {
    hits++;
    res.statusCode = req.headers['cookie'] === 'TM1SessionId=good' ? 200 : 401;
    res.end(res.statusCode === 200 ? '{"value":[]}' : '');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => { server.close(); });

const agent = (): http.Agent => new http.Agent({ keepAlive: true });
function cfg(): Tm1Config {
  return {
    serverUrl: `http://127.0.0.1:${port}`, username: 'CID', password: 'SEC', rejectUnauthorized: false,
    authType: 'v12-basic', version: 'v12',
    v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' },
  };
}
const url = (): string => `http://127.0.0.1:${port}/api/v1/Cubes`;

describe('v12 mint failure in the request flow', () => {
  it('never returns a failed mint as 2xx and carries the reason', async () => {
    mint.mockResolvedValue({ ok: false, status: 200, message: 'v12 session response had no TM1SessionId cookie' });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('no TM1SessionId cookie');
    expect(hits).toBe(0);
  });

  it('passes the mint error text through instead of an empty body', async () => {
    mint.mockResolvedValue({ ok: false, status: 400, message: 'v12 session mint failed with HTTP 400: bad tenant' });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('bad tenant');
  });

  it('does not latch a network error (status 0) as an auth failure', async () => {
    mint
      .mockResolvedValueOnce({ ok: false, status: 0, message: 'ECONNREFUSED' })
      .mockResolvedValue({ ok: true, cookie: 'TM1SessionId=good', agent: agent() });
    const c = cfg();
    expect((await request('GET', url(), c)).statusCode).toBe(0);
    expect((await request('GET', url(), c)).statusCode).toBe(200);
    _clearAuthFailed(c);
  });

  it('never returns a failed re-mint after a 401 as 2xx', async () => {
    mint
      .mockResolvedValueOnce({ ok: true, cookie: 'TM1SessionId=stale', agent: agent() })
      .mockResolvedValue({ ok: false, status: 200, message: 'v12 session response had no TM1SessionId cookie' });
    const res = await request('GET', url(), cfg());
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('no TM1SessionId cookie');
  });
});
