import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { listPawInstances } from '../tm1Rest/pawGatewayApi';
import { PawGatewayError } from '../tm1Rest/pawGatewayUrl';

const servers: http.Server[] = [];

async function serve(handler: http.RequestListener): Promise<{ baseUrl: string; requests: () => number }> {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, requests: () => requestCount };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('listPawInstances', () => {
  it('requests the PAW server list anonymously and maps strict rows', async () => {
    const fixture = await serve((req, res) => {
      expect(req.method).toBe('GET');
      // Anonymous via the TM1Proxy route — the `/api/v1` route requires a
      // session (measured on PAW Local 2.1.23, 2026-09-17).
      expect(req.url).toBe('/tm1/Servers');
      expect(req.headers.authorization).toBeUndefined();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ value: [
        { Name: 'SALES', AcceptingClients: true, Href: '/tm1/SALES' },
        { Name: 'Stopped', AcceptingClients: false },
      ] }));
    });

    await expect(listPawInstances(`${fixture.baseUrl}///`, false))
      .resolves.toEqual([
        { name: 'SALES', acceptingClients: true },
        { name: 'Stopped', acceptingClients: false },
      ]);
  });

  it('reports the 200 AUTH_REQUIRED answer as a 401, so the caller offers the browser login', async () => {
    // Body as a company PAW sent it, measured 2026-10-31.
    const fixture = await serve((_req, res) => res.end('{"error":{"code":"AUTH_REQUIRED","message":{"authenticate":{"location":"/login"}}}}'));
    const error = await listPawInstances(fixture.baseUrl, false).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PawGatewayError);
    expect(error).toMatchObject({ code: 'http', statusCode: 401 });
  });

  it('accepts an empty server list', async () => {
    const fixture = await serve((_req, res) => res.end('{"value":[]}'));
    await expect(listPawInstances(fixture.baseUrl, false)).resolves.toEqual([]);
  });

  it.each([401, 403, 302, 503])('reports HTTP %i without following redirects', async (statusCode) => {
    const target = await serve((_req, res) => res.end('{"value":[]}'));
    const fixture = await serve((_req, res) => {
      res.statusCode = statusCode;
      if (statusCode === 302) { res.setHeader('Location', `${target.baseUrl}/tm1/Servers`); }
      res.end();
    });

    const error = await listPawInstances(fixture.baseUrl, false)
      .then(() => undefined, (reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'http', statusCode });
    expect(error).toBeInstanceOf(PawGatewayError);
    expect(target.requests()).toBe(0);
  });

  it.each([
    ['invalid JSON', '{'],
    ['missing value', '{}'],
    ['non-array value', '{"value":{}}'],
    ['missing name', '{"value":[{"AcceptingClients":true}]}'],
    ['blank name', '{"value":[{"Name":"  ","AcceptingClients":true}]}'],
    ['dot segment name', '{"value":[{"Name":"..","AcceptingClients":true}]}'],
    ['non-boolean accepting state', '{"value":[{"Name":"SALES","AcceptingClients":1}]}'],
    ['duplicate name', '{"value":[{"Name":"SALES","AcceptingClients":true},{"Name":"SALES","AcceptingClients":false}]}'],
  ])('rejects %s as an invalid response', async (_label, body) => {
    const fixture = await serve((_req, res) => res.end(body));
    await expect(listPawInstances(fixture.baseUrl, false))
      .rejects.toMatchObject({ code: 'response' });
  });

  it('applies the timeout until the complete response body arrives', async () => {
    const fixture = await serve((_req, res) => {
      res.write('{"value":[');
      setTimeout(() => res.end(']}'), 100);
    });
    await expect(listPawInstances(fixture.baseUrl, false, 20))
      .rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects an aborted response', async () => {
    const fixture = await serve((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.flushHeaders();
      res.write('{"value":');
      setTimeout(() => res.destroy(), 10);
    });
    await expect(listPawInstances(fixture.baseUrl, false))
      .rejects.toMatchObject({ code: 'response' });
  });

  it('rejects invalid gateway URLs before making a request', async () => {
    await expect(listPawInstances('http://example.test/prefix', false))
      .rejects.toMatchObject({ code: 'url' });
  });

  it('preserves native connection errors for the caller network mapper', async () => {
    const unavailable = http.createServer();
    await new Promise<void>((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
    const port = (unavailable.address() as AddressInfo).port;
    await new Promise<void>((resolve) => unavailable.close(() => resolve()));

    const error = await listPawInstances(`http://127.0.0.1:${port}`, false)
      .then(() => undefined, (reason: unknown) => reason) as NodeJS.ErrnoException;
    expect(error).not.toBeInstanceOf(PawGatewayError);
    expect(error.code).toBe('ECONNREFUSED');
  });

  it('does not expose malformed payload text in response errors', async () => {
    const fixture = await serve((_req, res) => res.end('{"password":"top-secret"'));
    const error = await listPawInstances(fixture.baseUrl, false)
      .then(() => undefined, (reason: unknown) => reason) as Error;
    expect(error.message).toBe('Failed to parse PAW gateway response as JSON');
    expect(error.message).not.toContain('top-secret');
  });

  it('does not expose invalid or duplicate instance names in response errors', async () => {
    for (const body of [
      '{"value":[{"Name":"secret-name","AcceptingClients":true},{"Name":"secret-name","AcceptingClients":false}]}',
      '{"value":[{"Name":"\\ud800","AcceptingClients":true}]}',
    ]) {
      const fixture = await serve((_req, res) => res.end(body));
      const error = await listPawInstances(fixture.baseUrl, false)
        .then(() => undefined, (reason: unknown) => reason) as Error;
      expect(error).toBeInstanceOf(PawGatewayError);
      expect(error.message).not.toContain('secret-name');
      expect(error.message).not.toContain('URI malformed');
    }
  });

  it('connects to an IPv6 literal without passing URL brackets to Node', async (context) => {
    const server = http.createServer((_req, res) => res.end('{"value":[]}'));
    servers.push(server);
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(0, '::1', () => resolve(true));
    });
    if (!listening) {
      context.skip();
      return;
    }
    const port = (server.address() as AddressInfo).port;
    await expect(listPawInstances(`http://[::1]:${port}`, false))
      .resolves.toEqual([]);
  });
});
