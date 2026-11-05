import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { request } from '../tm1Rest/transport/http';
import { _clearAllSessionsForTest } from '../tm1Rest/transport/session';
import type { Tm1Config } from '../tm1Rest/transport/types';

let server: http.Server;
let port = 0;
let authHits = 0;
let lastDataCookie: string | undefined;

beforeEach(async () => {
  _clearAllSessionsForTest();
  authHits = 0; lastDataCookie = undefined;
  server = http.createServer((req, res) => {
    if (req.url === '/tm1/auth/v1/session' && req.method === 'POST') {
      authHits++;
      res.setHeader('Set-Cookie', 'TM1SessionId=JWT123; Path=/; HttpOnly');
      res.statusCode = 201; res.end('{}');
      return;
    }
    if (req.url === "/tm1/api/v1/Databases('db')/Cubes") {
      lastDataCookie = req.headers['cookie'];
      res.statusCode = 200; res.end('{"value":[]}');
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});
afterEach(() => { server.close(); });

function cfg(): Tm1Config {
  return { serverUrl: `http://127.0.0.1:${port}`, username: 'CID', password: 'SEC', rejectUnauthorized: false, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' } };
}

describe('v12 request flow', () => {
  it('mints a cookie then uses it for the data call', async () => {
    const res = await request('GET', `http://127.0.0.1:${port}/tm1/api/v1/Databases('db')/Cubes`, cfg());
    expect(res.statusCode).toBe(200);
    expect(authHits).toBe(1);
    expect(lastDataCookie).toBe('TM1SessionId=JWT123');
  });

  // Review 2026-11-02: the init lock stayed held until the first data call
  // returned, so every request waited behind it — behind a process run
  // without timeout, for the whole run.
  it('a slow first data call does not hold back a second request once the session exists', async () => {
    let releaseSlow: (() => void) | undefined;
    server.removeAllListeners('request');
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.url === '/tm1/auth/v1/session' && req.method === 'POST') {
        authHits++;
        res.setHeader('Set-Cookie', 'TM1SessionId=JWT123; Path=/; HttpOnly');
        res.statusCode = 201; res.end('{}');
        return;
      }
      if (req.url?.includes('ExecuteWithReturn')) {
        releaseSlow = () => { res.statusCode = 200; res.end('{}'); };
        return;
      }
      res.statusCode = 200; res.end('{"value":[]}');
    });
    const c = cfg();
    const base = `http://127.0.0.1:${port}/tm1/api/v1/Databases('db')`;
    const slow = request('POST', `${base}/Processes('P')/tm1.ExecuteWithReturn`, c, '{}');
    const fast = request('GET', `${base}/Cubes`, c);

    expect((await fast).statusCode).toBe(200);
    expect(authHits).toBe(1);
    await new Promise<void>(r => { const t = setInterval(() => { if (releaseSlow) { clearInterval(t); r(); } }, 5); });
    releaseSlow!();
    expect((await slow).statusCode).toBe(200);
  });

  // Review 2026-11-02: a network error on the re-mint came back as the data
  // call's 401 and read as "wrong credentials".
  it('a network error on the re-mint reports status 0, not 401', async () => {
    server.removeAllListeners('request');
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.url === '/tm1/auth/v1/session' && req.method === 'POST') {
        if (++authHits > 1) { req.socket.destroy(); return; }
        res.setHeader('Set-Cookie', 'TM1SessionId=JWT123; Path=/; HttpOnly');
        res.statusCode = 201; res.end('{}');
        return;
      }
      res.statusCode = 401; res.end('{"error":{"code":"278","message":"Authentication required"}}');
    });
    const res = await request('GET', `http://127.0.0.1:${port}/tm1/api/v1/Databases('db')/Cubes`, cfg());
    expect(authHits).toBe(2);
    expect(res.statusCode).toBe(0);
  });

  it('reuses the cached cookie on a second call (no second auth hit)', async () => {
    const c = cfg();
    await request('GET', `http://127.0.0.1:${port}/tm1/api/v1/Databases('db')/Cubes`, c);
    await request('GET', `http://127.0.0.1:${port}/tm1/api/v1/Databases('db')/Cubes`, c);
    expect(authHits).toBe(1);
  });
});

describe('v12 request flow - fresh-mint 401 persists (genuine, e.g. impersonation w/o rights)', () => {
  let badServer: http.Server;
  let badPort = 0;
  let badAuthHits = 0;

  beforeEach(async () => {
    _clearAllSessionsForTest();
    badAuthHits = 0;
    badServer = http.createServer((req, res) => {
      if (req.url === '/tm1/auth/v1/session' && req.method === 'POST') {
        badAuthHits++;
        // Mint always succeeds (fresh cookie minted)...
        res.setHeader('Set-Cookie', 'TM1SessionId=JWT123; Path=/; HttpOnly');
        res.statusCode = 201; res.end('{}');
        return;
      }
      if (req.url === "/tm1/api/v1/Databases('db')/Cubes") {
        // ...but every data call — even with a freshly re-minted cookie — 401s.
        res.statusCode = 401; res.end('{"error":{"code":"278","message":"Authentication required"}}');
        return;
      }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>(r => badServer.listen(0, '127.0.0.1', r));
    badPort = (badServer.address() as any).port;
  });
  afterEach(() => { badServer.close(); });

  function badCfg(): Tm1Config {
    return { serverUrl: `http://127.0.0.1:${badPort}`, username: 'CID', password: 'SEC', rejectUnauthorized: false, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' } };
  }

  it('C1: re-mints ONCE, and only after the fresh cookie also 401s arms the guard', async () => {
    const c = badCfg();
    const res1 = await request('GET', `http://127.0.0.1:${badPort}/tm1/api/v1/Databases('db')/Cubes`, c);
    expect(res1.statusCode).toBe(401);
    // initial mint + exactly one re-mint before locking out (not a re-mint storm)
    expect(badAuthHits).toBe(2);

    // guard now armed → second call short-circuits, no further minting
    const res2 = await request('GET', `http://127.0.0.1:${badPort}/tm1/api/v1/Databases('db')/Cubes`, c);
    expect(res2.statusCode).toBe(401);
    expect(badAuthHits).toBe(2);
  });
});

describe('v12 request flow - transient post-mint 401 recovers via one re-mint', () => {
  let srv: http.Server;
  let srvPort = 0;
  let authHits2 = 0;
  let dataHits = 0;

  beforeEach(async () => {
    _clearAllSessionsForTest();
    authHits2 = 0; dataHits = 0;
    srv = http.createServer((req, res) => {
      if (req.url === '/tm1/auth/v1/session' && req.method === 'POST') {
        authHits2++;
        res.setHeader('Set-Cookie', `TM1SessionId=JWT${authHits2}; Path=/; HttpOnly`);
        res.statusCode = 201; res.end('{}');
        return;
      }
      if (req.url === "/tm1/api/v1/Databases('db')/Cubes") {
        dataHits++;
        // First data call (stale/transient cookie) 401s; every later call is fine.
        if (dataHits === 1) { res.statusCode = 401; res.end('{"error":{"code":"278","message":"Authentication required"}}'); return; }
        res.statusCode = 200; res.end('{"value":[]}');
        return;
      }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    srvPort = (srv.address() as any).port;
  });
  afterEach(() => { srv.close(); });

  function c2(): Tm1Config {
    return { serverUrl: `http://127.0.0.1:${srvPort}`, username: 'CID', password: 'SEC', rejectUnauthorized: false, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' } };
  }

  it('re-mints once and the retry succeeds — no lockout', async () => {
    const c = c2();
    const res1 = await request('GET', `http://127.0.0.1:${srvPort}/tm1/api/v1/Databases('db')/Cubes`, c);
    expect(res1.statusCode).toBe(200);        // recovered, not bricked
    expect(authHits2).toBe(2);                // initial mint + one re-mint

    // guard NOT armed → next call reuses the re-minted session, no new mint
    const res2 = await request('GET', `http://127.0.0.1:${srvPort}/tm1/api/v1/Databases('db')/Cubes`, c);
    expect(res2.statusCode).toBe(200);
    expect(authHits2).toBe(2);
  });
});
