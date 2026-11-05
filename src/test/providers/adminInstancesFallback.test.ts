import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';

// The admin host does not run the instance; the next candidate answers.
const reported = vi.fn();
vi.mock('../../tm1Rest/adminServerApi', () => ({ listAdminInstances: () => reported() }));
import { listInstancesFor } from '../../providers/adminInstances';

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

function listen(): Promise<number> {
  server = createServer(s => s.destroy());
  return new Promise(r => server!.listen(0, '127.0.0.1', () => r((server!.address() as AddressInfo).port)));
}

describe('listInstancesFor picks the first candidate whose port answers', () => {
  it('admin host refuses, reported IP answers: the IP', async () => {
    const port = await listen();
    reported.mockResolvedValue([{ name: 'X', host: 'http://unused.invalid:1', acceptingClients: true,
      usingSSL: false, ipAddress: '127.0.0.1', ipv6Address: '', httpPortNumber: port }]);
    const [inst] = await listInstancesFor({ serverUrl: 'http://admin.invalid:5895', rejectUnauthorized: false });
    expect(inst.host).toBe(`http://127.0.0.1:${port}`);
  });

  it('nothing answers: the admin host stands, as before', async () => {
    reported.mockResolvedValue([{ name: 'X', host: 'http://unused.invalid:1', acceptingClients: true,
      usingSSL: false, ipAddress: '', ipv6Address: '', httpPortNumber: 9 }]);
    const [inst] = await listInstancesFor({ serverUrl: 'http://admin.invalid:5895', rejectUnauthorized: false });
    expect(inst.host).toBe('http://admin.invalid:9');
  });
});
