import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import { request } from '../tm1Rest/transport/http';
import { _clearAllSessionsForTest } from '../tm1Rest/transport/session';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * A request with `timeoutMs = 0` (process/chore execution — it may legitimately
 * take hours) has NO idle timer. Without TCP keep-alive probes on the in-flight
 * socket, a peer that vanishes mid-run (Wi-Fi drop, laptop suspend) never sends
 * FIN or RST, so the promise never settles: the caller's `finally` never runs
 * and the "Running" entry sticks forever. `keepAlive: true` on the http.Agent
 * does NOT cover this — Node arms socket keep-alive only for sockets returning
 * to the idle pool, never for the one currently carrying a request.
 */
let server: http.Server;
let port = 0;
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  _clearAllSessionsForTest();
  spy = vi.spyOn(net.Socket.prototype, 'setKeepAlive');
  server = http.createServer((_req, res) => { res.statusCode = 200; res.end('{"value":[]}'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterEach(() => { spy.mockRestore(); server.close(); });

function cfg(): Tm1Config {
  return {
    serverUrl: `http://127.0.0.1:${port}`,
    username: 'admin', password: '', rejectUnauthorized: false, authType: 'Basic',
  } as Tm1Config;
}

/** Node's own idle-pool arming uses keepAliveMsecs (1000); ours is distinct. */
function armedByUs(): boolean {
  return (spy.mock.calls as unknown[][]).some(c => c[0] === true && c[1] === 30000);
}

describe('_rawTransport socket keep-alive', () => {
  it('arms TCP keep-alive on a request without an idle timeout', async () => {
    const res = await request('GET', `http://127.0.0.1:${port}/api/v1/Cubes`, cfg(), undefined, 0);
    expect(res.statusCode).toBe(200);
    expect(armedByUs()).toBe(true);
  });

  it('leaves a request that HAS an idle timeout alone — it can already escape', async () => {
    const res = await request('GET', `http://127.0.0.1:${port}/api/v1/Cubes`, cfg(), undefined, 5000);
    expect(res.statusCode).toBe(200);
    expect(armedByUs()).toBe(false);
  });
});
