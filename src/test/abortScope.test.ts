import { afterEach, describe, it, expect } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { _rawRequest } from '../tm1Rest/transport/http';
import { runWithAbortSignal } from '../tm1Rest/transport/abortScope';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { _resetRequestGateForTest } from '../tm1Rest/transport/requestGate';

// A server that holds every request until the test releases it, like TM1
// computing a large view.
const servers: http.Server[] = [];
const held: http.ServerResponse[] = [];
async function slowServer(): Promise<string> {
  const server = http.createServer((req, res) => { req.resume(); held.push(res); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/x`;
}
afterEach(async () => {
  for (const res of held.splice(0)) { res.end('{}'); }
  await Promise.all(servers.splice(0).map(s => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); })));
});

const cfg = { serverUrl: 'http://127.0.0.1', username: 'u', password: 'p' } as unknown as Tm1Config;
const agent = new http.Agent();

describe('abortScope', () => {
  it('a GET inside an aborted scope rejects instead of waiting', async () => {
    const url = await slowServer();
    const ctl = new AbortController();
    const pending = runWithAbortSignal(ctl.signal, () =>
      _rawRequest('GET', url, cfg, undefined, 0, undefined, undefined, agent));
    await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });

  it('a POST in the same scope runs to completion', async () => {
    const url = await slowServer();
    const ctl = new AbortController();
    const pending = runWithAbortSignal(ctl.signal, () =>
      _rawRequest('POST', url, cfg, '{}', 0, undefined, undefined, agent));
    await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    held.splice(0).forEach(res => res.end('{"ok":1}'));
    await expect(pending).resolves.toMatchObject({ statusCode: 200, body: '{"ok":1}' });
  });

  it('a GET queued behind another panel keeps its own signal', async () => {
    const url = await slowServer();
    _resetRequestGateForTest(1);
    try {
      const a = new AbortController();
      const b = new AbortController();
      const pa = runWithAbortSignal(a.signal, () =>
        _rawRequest('GET', url, cfg, undefined, 0, undefined, undefined, agent));
      const pb = runWithAbortSignal(b.signal, () =>
        _rawRequest('GET', url, cfg, undefined, 0, undefined, undefined, agent));
      let bSettled = false;
      pb.then(() => { bSettled = true; }, () => { bSettled = true; });
      await new Promise((r) => setTimeout(r, 50));
      held.splice(0).forEach(res => res.end('{}'));
      await pa;
      await new Promise((r) => setTimeout(r, 50));
      // B now runs in A's freed slot: closing A must leave it alone ...
      a.abort();
      await new Promise((r) => setTimeout(r, 20));
      expect(bSettled).toBe(false);
      // ... and closing B must cancel it.
      b.abort();
      await expect(pb).rejects.toThrow(/abort/i);
    } finally {
      _resetRequestGateForTest();
    }
  });
});
