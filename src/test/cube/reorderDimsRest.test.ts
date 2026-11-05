import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import {
  getStorageDimensionOrder,
  getDimensionLeafCount,
  reorderCubeDimensions,
} from '../../tm1Rest/cubeApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';

let server: http.Server;

function startServer(handler: http.RequestListener): Promise<Tm1Config> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        serverUrl: `http://127.0.0.1:${port}`,
        username: 'admin',
        password: 'apple',
        rejectUnauthorized: false,
        authType: 'Basic',
      });
    });
  });
}

afterEach(() => {
  if (server?.listening) { server.close(); }
});

describe('getStorageDimensionOrder', () => {
  it('returns ordered dim names from OData response', async () => {
    const cfg = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        value: [{ Name: 'Time' }, { Name: 'Region' }, { Name: 'Product' }],
      }));
    });
    const order = await getStorageDimensionOrder(cfg, 'Sales');
    expect(order).toEqual(['Time', 'Region', 'Product']);
  });

  it('requests the correct URL path', async () => {
    let capturedUrl = '';
    const cfg = await startServer((req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: [] }));
    });
    await getStorageDimensionOrder(cfg, 'Sales');
    expect(capturedUrl).toContain('tm1.DimensionsStorageOrder()');
    expect(capturedUrl).toContain('$select=Name');
  });
});

describe('getDimensionLeafCount', () => {
  it('returns @odata.count from inline-count JSON response', async () => {
    let seenUrl = '';
    const cfg = await startServer((req, res) => {
      seenUrl = req.url || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ '@odata.count': 42, value: [] }));
    });
    const count = await getDimensionLeafCount(cfg, 'Region');
    expect(count).toBe(42);
    expect(seenUrl).toContain('$count=true');
    expect(seenUrl).not.toContain('/$count');
  });

  it('returns null on non-2xx status', async () => {
    const cfg = await startServer((_req, res) => {
      res.writeHead(400);
      res.end('bad');
    });
    expect(await getDimensionLeafCount(cfg, 'Region')).toBeNull();
  });

  it('returns null when the request throws (network error)', async () => {
    const cfg = await startServer((req, res) => {
      // Destroy the socket immediately to simulate a network error
      res.destroy();
    });
    expect(await getDimensionLeafCount(cfg, 'Region')).toBeNull();
  });
});

describe('reorderCubeDimensions', () => {
  it('POSTs bind body and returns percent value', async () => {
    let body = '';
    const cfg = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        body = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value: -23.07 }));
      });
    });
    const pct = await reorderCubeDimensions(cfg, 'Sales', ['Time', 'Region']);
    expect(pct).toBeCloseTo(-23.07);
    expect(JSON.parse(body)).toEqual({
      'Dimensions@odata.bind': ["Dimensions('Time')", "Dimensions('Region')"],
    });
  });

  it('throws ReorderDimensionsError versionGate kind on 404', async () => {
    const cfg = await startServer((_req, res) => {
      res.writeHead(404);
      res.end('not found');
    });
    await expect(reorderCubeDimensions(cfg, 'Sales', ['A'])).rejects.toMatchObject({
      name: 'ReorderDimensionsError',
      kind: 'versionGate',
      status: 404,
    });
  });

  it('extracts plain-string OData error message (ODataError string shape)', async () => {
    const cfg = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: '123', message: 'Dimension not found' } }));
    });
    await expect(reorderCubeDimensions(cfg, 'Sales', ['A']))
      .rejects.toThrow('Dimension not found');
  });

  it('extracts nested {value} OData error message (ODataError object shape)', async () => {
    const cfg = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: { value: 'Storage order change rejected' } } }));
    });
    await expect(reorderCubeDimensions(cfg, 'Sales', ['A']))
      .rejects.toThrow('Storage order change rejected');
  });
});
