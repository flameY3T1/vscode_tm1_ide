import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('../tm1Rest/transport/http', () => ({
  request: (_m: string, url: string) => { calls.push(url); return Promise.resolve({ statusCode: 200, body: '' }); },
  requestBinary: (_m: string, url: string) => { calls.push(url); return Promise.resolve({ statusCode: 200, body: Buffer.alloc(0) }); },
  assertOk: () => {},
}));

import { apiRequest, apiRequestBinary } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';

const v11: Tm1Config = { serverUrl: 'https://host:8010', username: 'a', password: '', rejectUnauthorized: true, authType: 'Basic' };
const v12: Tm1Config = { serverUrl: 'http://gw:4444', username: 'CID', password: 's', rejectUnauthorized: false, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' } };

beforeEach(() => { calls.length = 0; });

describe('apiRequest URL branch', () => {
  it('v11 keeps /api/v1', async () => {
    await apiRequest('GET', 'Cubes', undefined, undefined, v11);
    expect(calls[0]).toBe('https://host:8010/api/v1/Cubes');
  });
  it('v12 uses Databases prefix', async () => {
    await apiRequest('GET', 'Cubes', undefined, undefined, v12);
    expect(calls[0]).toBe("http://gw:4444/tm1/api/v1/Databases('db')/Cubes");
  });
  it('absolute apiPath is passed through unchanged', async () => {
    await apiRequest('GET', 'http://x/y', undefined, undefined, v12);
    expect(calls[0]).toBe('http://x/y');
  });
  it('apiRequestBinary v12 uses Databases prefix', async () => {
    await apiRequestBinary('GET', 'Files', undefined, v12);
    expect(calls[0]).toBe("http://gw:4444/tm1/api/v1/Databases('db')/Files");
  });
});
