import { afterEach, describe, it, expect } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { _rawRequest } from '../../tm1Rest/transport/http';
import type { Tm1Config } from '../../tm1Rest/transport/types';

// Body as a company PAW sent it without a session, measured 2026-10-31.
const AUTH_REQUIRED = '{"error":{"code":"AUTH_REQUIRED","message":{"authenticate":{"location":"/login"}}}}';

const servers: http.Server[] = [];
async function serve(body: string): Promise<string> {
  const server = http.createServer((req, res) => { req.resume(); res.end(body); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/tm1/DB/api/v1/Configuration`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); })));
});

const agent = new http.Agent();
const cfgOf = (authType: string) =>
  ({ serverUrl: 'http://127.0.0.1/api/v1/tm1/DB', username: '', password: '', authType } as unknown as Tm1Config);

describe('PAW AUTH_REQUIRED answer', () => {
  it('reads as 401 on a browser profile', async () => {
    const url = await serve(AUTH_REQUIRED);
    const res = await _rawRequest('GET', url, cfgOf('browser'), undefined, 5_000, undefined, 'TM1SessionId=x', agent);
    expect(res.statusCode).toBe(401);
  });
  it('stays 200 for other login types and for ordinary bodies', async () => {
    const url = await serve(AUTH_REQUIRED);
    expect((await _rawRequest('GET', url, cfgOf('Basic'), undefined, 5_000, undefined, 'TM1SessionId=x', agent)).statusCode).toBe(200);
    const ok = await serve('{"ProductVersion":"11.8"}');
    expect((await _rawRequest('GET', ok, cfgOf('browser'), undefined, 5_000, undefined, 'TM1SessionId=x', agent)).statusCode).toBe(200);
  });
});
