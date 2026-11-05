import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createDatabase, deleteDatabase, type RootCreds } from '../tm1Rest/managementApi';

let server: http.Server;
let port = 0;
const seen: { method: string; url: string; body: string; auth: string }[] = [];

beforeEach(async () => {
  seen.length = 0;
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body, auth: String(req.headers['authorization'] ?? '') });
      res.statusCode = req.method === 'POST' ? 201 : 204;
      res.end('');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
afterEach(() => server.close());

function root(): RootCreds {
  return { serverUrl: `http://127.0.0.1:${port}`, clientId: 'root', clientSecret: 'sec', rejectUnauthorized: false };
}

describe('management CRUD', () => {
  it('createDatabase POSTs {Name} to Instances(inst)/Databases with root Basic', async () => {
    await createDatabase(root(), 'tm1', 'new_db');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe("/manage/v1/Instances('tm1')/Databases");
    expect(JSON.parse(seen[0].body)).toEqual({ Name: 'new_db' });
    expect(seen[0].auth).toBe('Basic ' + Buffer.from('root:sec').toString('base64'));
  });

  it('deleteDatabase DELETEs the keyed database URL (OData-escaped)', async () => {
    await deleteDatabase(root(), 'tm1', "a'b");
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].url).toBe("/manage/v1/Instances('tm1')/Databases('a''b')");
  });

  it('non-2xx throws', async () => {
    server.removeAllListeners('request');
    server.on('request', (_req, res) => { res.statusCode = 403; res.end('{"error":"forbidden"}'); });
    await expect(createDatabase(root(), 'tm1', 'x')).rejects.toThrow(/HTTP 403/);
  });
});
