import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { request } from '../tm1Rest/transport/http';
import { _clearAllSessionsForTest } from '../tm1Rest/transport/session';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * PA as a Service (v12 SaaS) has no mint endpoint: Basic `apikey:<key>` goes on
 * the data call itself, the server answers with a `paSession` cookie, and later
 * calls carry only that cookie (measured 2026-10-14, 12.6.4). This pins the
 * transport branch in `http.ts` that skips `mintV12Cookie` for `authMode: 'saas'`.
 */

const DATA_PATH = '/api/TENANT1/v0/tm1/db/api/v1/Cubes';

let server: http.Server;
let port = 0;
/** Every request, in order: its Authorization and Cookie headers. */
let hits: Array<{ url: string; method: string; auth?: string; cookie?: string }> = [];
/** Cookies the server currently accepts. */
let validCookies: Set<string>;

beforeEach(async () => {
  _clearAllSessionsForTest();
  hits = [];
  validCookies = new Set(['paSession=s%3Aabc.def']);
  server = http.createServer((req, res) => {
    hits.push({ url: req.url ?? '', method: req.method ?? '', auth: req.headers['authorization'], cookie: req.headers['cookie'] });
    if (req.url !== DATA_PATH) { res.statusCode = 404; res.end(); return; }
    if (req.headers['cookie'] && validCookies.has(req.headers['cookie'])) {
      res.statusCode = 200; res.end('{"value":[]}'); return;
    }
    if (req.headers['authorization'] === 'Basic ' + Buffer.from('apikey:KEY').toString('base64')) {
      res.setHeader('Set-Cookie', 'paSession=s%3Aabc.def; Path=/; HttpOnly; Secure; SameSite=None');
      res.statusCode = 200; res.end('{"value":[]}'); return;
    }
    res.statusCode = 401; res.end('{"error":{"code":"278","message":"Authentication required"}}');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});
afterEach(() => { server.close(); });

function cfg(): Tm1Config {
  return {
    serverUrl: `http://127.0.0.1:${port}`, username: 'apikey', password: 'KEY', rejectUnauthorized: false,
    authType: 'v12-basic', version: 'v12',
    v12: { instance: 'TENANT1', database: 'db', authMode: 'saas', tm1User: '' },
  };
}

describe('v12 SaaS request flow', () => {
  it('sends Basic on the data call itself, never a mint POST, and reuses paSession afterwards', async () => {
    const c = cfg();
    const first = await request('GET', `http://127.0.0.1:${port}${DATA_PATH}`, c);
    const second = await request('GET', `http://127.0.0.1:${port}${DATA_PATH}`, c);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(hits.map(h => h.url)).toEqual([DATA_PATH, DATA_PATH]);
    expect(hits.every(h => h.method === 'GET')).toBe(true);
    expect(hits[0].auth).toBe('Basic ' + Buffer.from('apikey:KEY').toString('base64'));
    expect(hits[0].cookie).toBeUndefined();
    // Cookie only — Basic next to a cookie opens a fresh session on some servers.
    expect(hits[1].cookie).toBe('paSession=s%3Aabc.def');
    expect(hits[1].auth).toBeUndefined();
  });

  it('on 401 with a cached paSession, retries once with Basic and caches the new cookie', async () => {
    const c = cfg();
    await request('GET', `http://127.0.0.1:${port}${DATA_PATH}`, c);
    // Server-side the session expired.
    validCookies.clear();
    const res = await request('GET', `http://127.0.0.1:${port}${DATA_PATH}`, c);
    expect(res.statusCode).toBe(200);
    expect(hits.map(h => h.url)).toEqual([DATA_PATH, DATA_PATH, DATA_PATH]);
    expect(hits[1].cookie).toBe('paSession=s%3Aabc.def');
    expect(hits[1].auth).toBeUndefined();
    expect(hits[2].auth).toBe('Basic ' + Buffer.from('apikey:KEY').toString('base64'));
  });
});
