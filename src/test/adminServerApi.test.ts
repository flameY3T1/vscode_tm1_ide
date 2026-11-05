import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { listAdminInstances } from '../tm1Rest/adminServerApi';

let server: http.Server;
let port = 0;
let lastPath = '';
let lastAccept: string | undefined;
let body = '';
let status = 200;

beforeEach(async () => {
  status = 200;
  body = JSON.stringify({
    '@odata.context': '$metadata#Servers',
    value: [
      {
        Name: 'SALES', SelfRegistered: true, Host: 'https://TM1HOST:12357',
        IPAddress: '0.0.0.0', PortNumber: 12356, HTTPPortNumber: 12357,
        UsingSSL: true, AcceptingClients: true, LastUpdated: '2026-08-27T17:09:14.539Z',
      },
      {
        Name: 'HRPlan', SelfRegistered: true, Host: 'https://TM1HOST:12322',
        IPAddress: '0.0.0.0', PortNumber: 12321, HTTPPortNumber: 12322,
        UsingSSL: true, AcceptingClients: false, LastUpdated: '2026-08-27T17:09:11.871Z',
      },
    ],
  });
  server = http.createServer((req, res) => {
    lastPath = req.url ?? '';
    lastAccept = req.headers['accept'] as string | undefined;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(body);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterEach(() => { server.close(); });

const url = () => `http://127.0.0.1:${port}`;

describe('listAdminInstances', () => {
  it('reads the Servers collection and maps the fields we use', async () => {
    const list = await listAdminInstances(url(), false);
    expect(lastPath).toBe('/api/v1/Servers');
    expect(lastAccept).toContain('application/json');
    expect(list).toEqual([
      {
        name: 'SALES', host: 'https://TM1HOST:12357', acceptingClients: true, usingSSL: true,
        ipAddress: '0.0.0.0', ipv6Address: '', httpPortNumber: 12357,
        lastUpdated: '2026-08-27T17:09:14.539Z',
      },
      {
        name: 'HRPlan', host: 'https://TM1HOST:12322', acceptingClients: false, usingSSL: true,
        ipAddress: '0.0.0.0', ipv6Address: '', httpPortNumber: 12322,
        lastUpdated: '2026-08-27T17:09:11.871Z',
      },
    ]);
  });

  it('reports every instance — filtering by AcceptingClients is the caller\'s job', async () => {
    // The display rule belongs in the pure matching function (Task 2), so
    // that it can be tested without a network.
    expect((await listAdminInstances(url(), false)).map(i => i.acceptingClients)).toEqual([true, false]);
  });

  it('trims a trailing slash on the admin URL instead of building //api', async () => {
    await listAdminInstances(`${url()}/`, false);
    expect(lastPath).toBe('/api/v1/Servers');
  });

  it('returns an empty list when the collection is empty', async () => {
    body = JSON.stringify({ value: [] });
    expect(await listAdminInstances(url(), false)).toEqual([]);
  });

  it('throws with the status code on a non-2xx answer', async () => {
    status = 503;
    body = 'Service Unavailable';
    await expect(listAdminInstances(url(), false)).rejects.toThrow(/503/);
  });

  it('throws a readable error on a broken body instead of returning junk', async () => {
    body = '{ not json';
    await expect(listAdminInstances(url(), false)).rejects.toThrow(/JSON|parse/i);
  });

  it('tolerates a missing value array', async () => {
    body = JSON.stringify({ '@odata.context': '$metadata#Servers' });
    expect(await listAdminInstances(url(), false)).toEqual([]);
  });

  it('rejects when the connection dies mid-body instead of hanging forever', async () => {
    const flaky = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"value":[');
      setImmediate(() => res.destroy());
    });
    await new Promise<void>(r => flaky.listen(0, '127.0.0.1', r));
    const flakyPort = (flaky.address() as { port: number }).port;
    try {
      await expect(listAdminInstances(`http://127.0.0.1:${flakyPort}`, false)).rejects.toThrow();
    } finally {
      flaky.close();
    }
  }, 5000);
});
